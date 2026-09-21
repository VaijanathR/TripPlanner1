"""Rate limiting of the public sign-in endpoints (specs: api-contract "Rate limits",
backend-spec "Rate limiting")."""

import concurrent.futures
import datetime
import hashlib
import logging
import os
import pathlib
import re
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from starlette.requests import Request

import auth
import models
import ratelimit
from errors import AppError
from main import app

BACKEND = pathlib.Path(__file__).resolve().parent.parent
PASSWORD = "correct-horse-battery"
OTHER_PASSWORD = "definitely-not-the-password"


def xff(address):
    return {"X-Forwarded-For": address}


def register(client, email, address="198.51.100.1", password=PASSWORD):
    return client.post("/api/auth/register", json={"email": email, "password": password}, headers=xff(address))


def login(client, email, password=PASSWORD, address="203.0.113.7"):
    return client.post("/api/auth/login", json={"email": email, "password": password}, headers=xff(address))


def fail(client, email="alice@example.com", address="203.0.113.7"):
    return login(client, email, OTHER_PASSWORD, address)


class Clock:
    def __init__(self):
        self.now = datetime.datetime.now(datetime.UTC)

    def __call__(self):
        return self.now

    def advance(self, **kwargs):
        self.now += datetime.timedelta(**kwargs)


@pytest.fixture()
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(ratelimit, "_now", c)
    return c


@pytest.fixture()
def alice(anon_client):
    assert register(anon_client, "alice@example.com").status_code == 201
    return anon_client


def rows(db_session_factory, **filters):
    with db_session_factory() as db:
        return db.query(models.AuthAttempt).filter_by(**filters).all()


def assert_locked(resp):
    assert resp.status_code == 429, resp.text
    assert resp.json()["error"]["code"] == "too_many_attempts"
    assert re.fullmatch(r"Too many attempts\. Try again in \d+ minutes?\.", resp.json()["error"]["message"])
    assert int(resp.headers["Retry-After"]) >= 1


# ------------------------------------------------------------ caller address


def make_request(header=None, client=("9.9.9.9", 5555)):
    headers = [(b"x-forwarded-for", header.encode())] if header is not None else []
    return Request({"type": "http", "headers": headers, "client": client})


@pytest.mark.parametrize(
    "header,expected",
    [
        ("203.0.113.5", "203.0.113.5"),
        ("203.0.113.5:4711", "203.0.113.5"),
        ("1.1.1.1, 203.0.113.5:4711", "203.0.113.5"),
        ("forged-by-the-caller, 198.51.100.9", "198.51.100.9"),
        ("[2001:db8::1]:443", "2001:db8::1"),
        ("2001:db8::1", "2001:db8::1"),
        ("1.1.1.1, ,", "1.1.1.1"),
        ("  10.0.0.1  ", "10.0.0.1"),
    ],
)
def test_the_caller_address_is_the_last_forwarded_entry_without_its_port(header, expected):
    assert ratelimit.client_address(make_request(header)) == expected


@pytest.mark.parametrize("header", [None, "", " , "])
def test_without_a_usable_forwarded_header_the_connections_own_address_is_used(header):
    assert ratelimit.client_address(make_request(header)) == "9.9.9.9"


def test_a_request_with_no_address_at_all_still_gets_a_stable_key():
    assert ratelimit.client_address(make_request(None, client=None)) == "unknown"


# --------------------------------------------------------- R1: password logins


def test_three_failed_logins_are_answered_normally(alice):
    for _ in range(3):
        resp = fail(alice)
        assert resp.status_code == 401 and resp.json()["error"]["code"] == "invalid_credentials"


def test_after_three_failures_even_the_correct_password_is_refused(alice, clock):
    for _ in range(3):
        fail(alice)

    resp = login(alice, "alice@example.com", PASSWORD)

    assert_locked(resp)
    assert resp.json()["error"]["message"] == "Too many attempts. Try again in 15 minutes."
    assert resp.headers["Retry-After"] == "900"


def test_a_registered_and_an_unknown_email_are_locked_exactly_alike(alice, clock):
    for _ in range(3):
        fail(alice, "alice@example.com")
        fail(alice, "ghost@example.com")

    real = login(alice, "alice@example.com", PASSWORD)
    ghost = login(alice, "ghost@example.com", PASSWORD)

    assert real.status_code == ghost.status_code == 429
    assert real.json() == ghost.json() and real.headers["Retry-After"] == ghost.headers["Retry-After"]


def test_the_email_is_counted_regardless_of_letter_case_and_stray_spaces(alice):
    fail(alice, "alice@example.com")
    fail(alice, "ALICE@example.com")
    fail(alice, "  Alice@Example.com ")

    assert_locked(login(alice, "alice@example.com", PASSWORD))


def test_the_limiter_normalises_emails_itself_and_does_not_rely_on_the_request_schema(anon_client, db_session_factory):
    request = make_request("203.0.113.7")
    with db_session_factory() as db:
        for typed in ("alice@example.com", "ALICE@example.com", "  Alice@Example.com "):
            ratelimit.reserve_login_attempt(db, request, typed)

        stored = {r.email_hash for r in db.query(models.AuthAttempt).filter_by(kind="login_failure")}
        assert stored == {ratelimit.keyed_hash("alice@example.com")}
        with pytest.raises(AppError) as refused:
            ratelimit.reserve_login_attempt(db, request, " aLiCe@example.com")  # the fourth, however written
    assert refused.value.status_code == 429


def test_a_lock_on_one_email_does_not_affect_another_email_from_the_same_address(alice):
    register(alice, "bob@example.com")
    for _ in range(3):
        fail(alice, "alice@example.com")

    assert login(alice, "bob@example.com").status_code == 200


def test_the_same_email_from_another_address_is_not_locked_out(alice):
    for _ in range(3):
        fail(alice, "alice@example.com", address="203.0.113.7")

    assert_locked(login(alice, "alice@example.com", address="203.0.113.7"))
    assert login(alice, "alice@example.com", address="203.0.113.99").status_code == 200


def test_a_forged_earlier_forwarded_entry_does_not_evade_the_limit(alice):
    for i in range(3):
        login(alice, "alice@example.com", OTHER_PASSWORD, address=f"10.0.0.{i}, 203.0.113.7")

    resp = login(alice, "alice@example.com", PASSWORD, address="192.0.2.55, 203.0.113.7")

    assert_locked(resp)


def test_the_lock_ends_when_the_oldest_failure_leaves_the_window(alice, clock):
    fail(alice)                       # minute 0
    clock.advance(minutes=5)
    fail(alice)                       # minute 5
    clock.advance(minutes=5)
    fail(alice)                       # minute 10

    clock.advance(minutes=1)          # minute 11: locked until the minute-0 failure ages out
    locked = login(alice, "alice@example.com", PASSWORD)
    assert_locked(locked)
    assert locked.json()["error"]["message"] == "Too many attempts. Try again in 4 minutes."
    assert locked.headers["Retry-After"] == str(4 * 60)

    clock.advance(minutes=3, seconds=59)   # 14:59 -- still locked
    assert login(alice, "alice@example.com", PASSWORD).status_code == 429
    clock.advance(seconds=2)               # 15:01 -- the first failure has aged out
    assert login(alice, "alice@example.com", PASSWORD).status_code == 200


def test_a_short_wait_is_worded_as_one_minute(alice, clock):
    for _ in range(3):
        fail(alice)
    clock.advance(minutes=14, seconds=30)

    resp = login(alice, "alice@example.com", PASSWORD)

    assert resp.json()["error"]["message"] == "Too many attempts. Try again in 1 minute."
    assert resp.headers["Retry-After"] == "30"


def test_hammering_a_locked_account_does_not_extend_the_lock(alice, clock):
    for _ in range(3):
        fail(alice)                                   # minute 0
    for _ in range(14):
        clock.advance(minutes=1)
        assert login(alice, "alice@example.com", OTHER_PASSWORD).status_code == 429   # hammering, minutes 1-14

    clock.advance(minutes=1, seconds=1)               # 15 minutes after the FIRST failure

    assert login(alice, "alice@example.com", PASSWORD).status_code == 200


def test_refused_attempts_are_not_recorded(alice, db_session_factory):
    for _ in range(3):
        fail(alice)
    for _ in range(10):
        login(alice, "alice@example.com", OTHER_PASSWORD)

    assert len(rows(db_session_factory, kind="login_failure")) == 3


def test_a_successful_login_forgets_that_emails_earlier_failures(alice):
    fail(alice)
    fail(alice)
    assert login(alice, "alice@example.com").status_code == 200  # success clears the count

    for _ in range(3):
        assert fail(alice).status_code == 401  # three fresh failures are allowed again
    assert_locked(login(alice, "alice@example.com", PASSWORD))


def test_a_success_from_one_address_does_not_clear_another_addresss_failures(alice):
    for _ in range(3):
        fail(alice, address="203.0.113.7")

    assert login(alice, "alice@example.com", address="203.0.113.99").status_code == 200

    assert_locked(login(alice, "alice@example.com", address="203.0.113.7"))


def test_a_burst_of_parallel_guesses_cannot_slip_past_the_limit(alice):
    """The attempt is recorded before the password is checked, so 12 simultaneous
    wrong guesses get exactly three answers of 401 and the rest 429."""

    def guess(_):
        with TestClient(app) as c:
            return login(c, "alice@example.com", OTHER_PASSWORD).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        codes = list(pool.map(guess, range(12)))

    assert sorted(codes) == [401] * 3 + [429] * 9


# ------------------------------------------------------- R2: per-address total


def test_thirty_failures_from_one_address_lock_that_address_whatever_email_is_used(anon_client, clock):
    for i in range(30):
        assert fail(anon_client, f"guess{i}@example.com").status_code == 401

    resp = login(anon_client, "someone-new@example.com", PASSWORD)

    assert_locked(resp)
    assert resp.json()["error"]["message"] == "Too many attempts. Try again in 15 minutes."


def test_the_per_address_lock_also_refuses_a_valid_login_from_that_address(anon_client):
    register(anon_client, "alice@example.com")
    for i in range(30):
        fail(anon_client, f"guess{i}@example.com")

    assert_locked(login(anon_client, "alice@example.com", PASSWORD))


def test_the_per_address_lock_does_not_touch_other_addresses(anon_client):
    register(anon_client, "alice@example.com")
    for i in range(30):
        fail(anon_client, f"guess{i}@example.com")

    assert login(anon_client, "alice@example.com", PASSWORD, address="203.0.113.99").status_code == 200


def test_the_per_address_lock_ends_with_its_window(anon_client, clock):
    register(anon_client, "alice@example.com")
    for i in range(30):
        fail(anon_client, f"guess{i}@example.com")
    clock.advance(minutes=14)
    assert login(anon_client, "alice@example.com", PASSWORD).status_code == 429

    clock.advance(minutes=1, seconds=1)

    assert login(anon_client, "alice@example.com", PASSWORD).status_code == 200


def test_successful_logins_do_not_count_towards_the_per_address_limit(anon_client):
    register(anon_client, "alice@example.com")

    for _ in range(35):
        assert login(anon_client, "alice@example.com").status_code == 200


# ------------------------------------------------------------- R3: sign-ups


def test_ten_signup_attempts_an_hour_per_address_then_the_eleventh_is_refused(anon_client):
    for i in range(10):
        assert register(anon_client, f"user{i}@example.com", address="192.0.2.10").status_code == 201

    resp = register(anon_client, "user10@example.com", address="192.0.2.10")

    assert_locked(resp)
    assert resp.json()["error"]["message"] == "Too many attempts. Try again in 60 minutes."


def test_failed_and_invalid_signup_attempts_count_too(anon_client):
    register(anon_client, "taken@example.com", address="192.0.2.10")            # 1: created
    for _ in range(5):
        assert register(anon_client, "taken@example.com", address="192.0.2.10").status_code == 409  # 2-6
    for _ in range(4):
        assert register(anon_client, "not-an-email", address="192.0.2.10").status_code == 422  # 7-10

    assert_locked(register(anon_client, "fresh@example.com", address="192.0.2.10"))


def test_signups_from_another_address_are_unaffected(anon_client):
    for i in range(10):
        register(anon_client, f"user{i}@example.com", address="192.0.2.10")

    assert register(anon_client, "fresh@example.com", address="192.0.2.99").status_code == 201


def test_the_signup_window_is_an_hour(anon_client, clock):
    for i in range(10):
        register(anon_client, f"user{i}@example.com", address="192.0.2.10")
    clock.advance(minutes=59)
    assert register(anon_client, "early@example.com", address="192.0.2.10").status_code == 429

    clock.advance(minutes=1, seconds=1)

    assert register(anon_client, "later@example.com", address="192.0.2.10").status_code == 201


# ------------------------------------------------------------- R4: Google


@pytest.fixture()
def google_rejecting(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com")

    def reject(_credential):
        raise auth.GoogleTokenInvalid("forged")

    monkeypatch.setattr(auth, "verify_google_id_token", reject)


def google(client, address="203.0.113.7"):
    return client.post("/api/auth/google", json={"credential": "x"}, headers=xff(address))


def test_twenty_google_attempts_per_address_then_the_next_is_refused(anon_client, google_rejecting):
    for _ in range(20):
        assert google(anon_client).status_code == 401

    resp = google(anon_client)

    assert_locked(resp)
    assert resp.json()["error"]["message"] == "Too many attempts. Try again in 15 minutes."


def test_google_attempts_from_another_address_are_unaffected(anon_client, google_rejecting):
    for _ in range(20):
        google(anon_client)

    assert google(anon_client, address="203.0.113.99").status_code == 401


def test_the_google_window_is_fifteen_minutes(anon_client, google_rejecting, clock):
    for _ in range(20):
        google(anon_client)
    clock.advance(minutes=14)
    assert google(anon_client).status_code == 429

    clock.advance(minutes=1, seconds=1)

    assert google(anon_client).status_code == 401


def test_a_password_lock_never_blocks_google_sign_in(anon_client, monkeypatch):
    register(anon_client, "alice@example.com")
    for _ in range(3):
        fail(anon_client)
    assert_locked(login(anon_client, "alice@example.com", PASSWORD))
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com")
    monkeypatch.setattr(
        auth, "verify_google_id_token", lambda _c: auth.GoogleIdentity(sub="g-1", email="alice@example.com")
    )

    resp = google(anon_client)

    assert resp.status_code == 200


def test_the_four_rules_are_independent_of_each_other(anon_client, google_rejecting):
    register(anon_client, "alice@example.com")
    for _ in range(10):
        register(anon_client, "spam@example.com", address="192.0.2.10")           # exhaust R3 for that address
    for _ in range(20):
        google(anon_client, address="192.0.2.10")                                   # exhaust R4 for it too

    assert login(anon_client, "alice@example.com", address="192.0.2.10").status_code == 200  # logins unaffected


def test_every_refusal_has_the_documented_shape(anon_client, google_rejecting, alice):
    for _ in range(3):
        fail(anon_client)
    for i in range(10):
        register(anon_client, f"u{i}@example.com", address="192.0.2.10")
    for _ in range(20):
        google(anon_client)

    for resp in (
        login(anon_client, "alice@example.com", PASSWORD),
        register(anon_client, "x@example.com", address="192.0.2.10"),
        google(anon_client),
    ):
        assert resp.status_code == 429
        assert set(resp.json()) == {"error"} and set(resp.json()["error"]) == {"code", "message"}
        assert resp.headers["Retry-After"].isdigit()


# --------------------------------------------------- storage: hashed, purged, durable


def test_only_hashes_are_stored_never_the_raw_email_or_address(alice, db_session_factory):
    fail(alice, "alice@example.com", address="203.0.113.7")
    register(alice, "carol@example.com", address="192.0.2.44")

    with db_session_factory() as db:
        stored = [
            (r.kind, r.email_hash, r.address_hash) for r in db.query(models.AuthAttempt).all()
        ]
    flat = " ".join(str(v) for row in stored for v in row)
    assert "alice@example.com" not in flat and "carol@example.com" not in flat
    assert "203.0.113.7" not in flat and "192.0.2.44" not in flat
    failure = next(r for r in stored if r[0] == "login_failure")
    assert failure[1] == ratelimit.keyed_hash("alice@example.com")
    assert failure[2] == ratelimit.keyed_hash("203.0.113.7")
    assert re.fullmatch(r"[0-9a-f]{64}", failure[1]) and re.fullmatch(r"[0-9a-f]{64}", failure[2])


def test_stored_hashes_are_not_plain_sha256_so_a_table_leak_cannot_be_brute_forced(alice, db_session_factory):
    fail(alice, "alice@example.com", address="203.0.113.7")

    with db_session_factory() as db:
        failure = db.query(models.AuthAttempt).filter_by(kind="login_failure").one()
    for raw, stored in (("alice@example.com", failure.email_hash), ("203.0.113.7", failure.address_hash)):
        assert stored != hashlib.sha256(raw.encode()).hexdigest()


def test_the_stored_hashes_depend_on_the_application_secret(monkeypatch):
    first = ratelimit.keyed_hash("203.0.113.7")
    assert ratelimit.keyed_hash("203.0.113.7") == first  # stable, or limits could never match

    monkeypatch.setenv("JWT_SECRET", "another-secret-that-is-at-least-32-characters-long")
    assert ratelimit.keyed_hash("203.0.113.7") != first

    monkeypatch.undo()
    assert ratelimit.keyed_hash("203.0.113.7") == first


def test_different_values_get_different_hashes():
    assert ratelimit.keyed_hash("203.0.113.7") != ratelimit.keyed_hash("203.0.113.8")


def test_a_successful_login_leaves_no_failure_record_behind(alice, db_session_factory):
    login(alice, "alice@example.com")

    assert rows(db_session_factory, kind="login_failure") == []


def test_signups_and_google_attempts_are_recorded_by_address_only(anon_client, google_rejecting, db_session_factory):
    register(anon_client, "carol@example.com", address="192.0.2.44")
    google(anon_client, address="192.0.2.45")

    signup = rows(db_session_factory, kind="signup")[0]
    goog = rows(db_session_factory, kind="google")[0]
    assert signup.email_hash is None and goog.email_hash is None
    assert signup.address_hash == ratelimit.keyed_hash("192.0.2.44")


def test_old_records_are_purged_but_recent_ones_are_kept(alice, db_session_factory, clock):
    with db_session_factory() as db:
        for age_hours in (3, 5):
            db.add(models.AuthAttempt(kind="login_failure", email_hash="old", address_hash="old",
                                      created_at=clock.now - datetime.timedelta(hours=age_hours)))
        db.add(models.AuthAttempt(kind="login_failure", email_hash="recent", address_hash="recent",
                                  created_at=clock.now - datetime.timedelta(minutes=30)))
        db.commit()

    clock.advance(minutes=11)  # the sign-up in the fixture already purged; wait until another purge is due
    fail(alice)  # any attempt triggers it

    with db_session_factory() as db:
        remaining = {r.email_hash for r in db.query(models.AuthAttempt)}
    assert "old" not in remaining and "recent" in remaining


def test_the_purge_is_not_run_on_every_attempt(alice, db_session_factory, clock):
    fail(alice)  # purge runs now
    with db_session_factory() as db:
        db.add(models.AuthAttempt(kind="login_failure", email_hash="old", address_hash="old",
                                  created_at=clock.now - datetime.timedelta(hours=5)))
        db.commit()

    clock.advance(minutes=5)
    login(alice, "alice@example.com")
    assert any(r.email_hash == "old" for r in rows(db_session_factory))   # too soon to purge again

    clock.advance(minutes=6)
    login(alice, "alice@example.com")
    assert not any(r.email_hash == "old" for r in rows(db_session_factory))


def test_a_lock_survives_a_restart_because_the_counters_are_in_the_database(tmp_path):
    db_url = f"sqlite:///{tmp_path / 'keep' / 'trip.db'}"
    env = {**{k: v for k, v in os.environ.items() if k != "DATABASE_URL"}, "DATABASE_URL": db_url}
    migrate = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"), "upgrade", "head"],
        cwd=BACKEND, env=env, capture_output=True, text=True,
    )
    assert migrate.returncode == 0, migrate.stderr

    def in_new_process(code):
        return subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True)

    common = (
        "from fastapi.testclient import TestClient\nfrom main import app\n"
        "H={'X-Forwarded-For':'203.0.113.7'}\n"
        "c=TestClient(app)\n"
        "post=lambda: c.post('/api/auth/login', json={'email':'ghost@example.com','password':'whatever-1'}, headers=H).status_code\n"
    )
    first = in_new_process(common + "print([post() for _ in range(3)])")
    second = in_new_process(common + "print(post())")   # a brand-new process: nothing in memory

    assert first.returncode == 0 and first.stdout.strip() == "[401, 401, 401]", first.stderr
    assert second.stdout.strip() == "429", second.stderr


# ----------------------------------------------------------- failing open


@pytest.fixture()
def broken_attempts_table(monkeypatch):
    def broken(_db):
        raise OperationalError("select", {}, Exception("database is locked"))

    monkeypatch.setattr(ratelimit, "_session", broken)


def test_login_still_works_when_the_attempts_table_is_unavailable(alice, broken_attempts_table, caplog):
    with caplog.at_level(logging.ERROR, logger="trip_planner.ratelimit"):
        good = login(alice, "alice@example.com")
        bad = fail(alice)

    assert good.status_code == 200
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "invalid_credentials"
    assert "rate limiter unavailable" in caplog.text


def test_signup_and_google_still_work_when_the_attempts_table_is_unavailable(
    anon_client, broken_attempts_table, monkeypatch, caplog
):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com")
    monkeypatch.setattr(auth, "verify_google_id_token", lambda _c: auth.GoogleIdentity(sub="g", email="g@example.com"))

    with caplog.at_level(logging.ERROR, logger="trip_planner.ratelimit"):
        assert register(anon_client, "new@example.com").status_code == 201
        assert google(anon_client).status_code == 200

    assert caplog.text.count("rate limiter unavailable") >= 2


def test_when_the_table_is_unavailable_nothing_is_ever_locked(alice, broken_attempts_table):
    for _ in range(6):
        assert fail(alice).status_code == 401


def test_a_real_lock_is_not_mistaken_for_a_failure_of_the_limiter(alice, caplog):
    for _ in range(3):
        fail(alice)

    with caplog.at_level(logging.ERROR, logger="trip_planner.ratelimit"):
        resp = login(alice, "alice@example.com", PASSWORD)

    assert resp.status_code == 429
    assert "rate limiter unavailable" not in caplog.text
