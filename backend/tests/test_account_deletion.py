"""Account deletion and the admin role (specs: backend-spec "Account deletion and
the admin role"; api-contract "Auth" and "Admin"; acceptance matrix section O)."""

import logging
import re

import pytest

import auth
import models

PASSWORD = "correct-horse-battery"
WRONG = "definitely-not-the-password"
ADMIN = "boss@example.com"


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def register(client, email, address="198.51.100.1", **extra):
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, **extra},
        headers={"X-Forwarded-For": address},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"], resp.json()["user"]["id"]


def delete_me(client, token, confirmation, address="203.0.113.7"):
    return client.request(
        "DELETE", "/api/auth/me", json={"confirmation": confirmation},
        headers={**bearer(token), "X-Forwarded-For": address},
    )


def login(client, email, password, address="203.0.113.7"):
    return client.post(
        "/api/auth/login", json={"email": email, "password": password}, headers={"X-Forwarded-For": address}
    )


def make_trip_with_activity(client, token, name="Kyoto"):
    trip = client.post("/api/trips", json={"name": name}, headers=bearer(token)).json()
    day = client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto"}, headers=bearer(token)
    ).json()
    client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={
            "date": "2026-11-03", "location": "Kyoto", "notes": None,
            "activities": [{"id": None, "title": "Hike", "start_time": "08:00", "end_time": "10:00", "order_index": 0}],
        },
        headers=bearer(token),
    )
    return trip


def make_google_only_user(db_session_factory, email):
    """An account that has only ever signed in with Google: no password."""
    with db_session_factory() as db:
        user = models.User(email=email, google_sub=f"sub-{email}")
        db.add(user)
        db.commit()
        db.refresh(user)
        return auth.create_access_token(user), user.id


def counts(db_session_factory):
    with db_session_factory() as db:
        return {
            "users": db.query(models.User).count(),
            "trips": db.query(models.Trip).count(),
            "days": db.query(models.Day).count(),
            "activities": db.query(models.Activity).count(),
        }


def user_exists(db_session_factory, user_id):
    with db_session_factory() as db:
        return db.get(models.User, user_id) is not None


@pytest.fixture()
def admins(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", f"{ADMIN}, other-admin@example.com")


# ------------------------------------------------------------ user object


def test_user_objects_say_whether_the_account_is_an_administrator_and_has_a_password(anon_client, admins, db_session_factory):
    token, _ = register(anon_client, "alice@example.com")
    boss_token, _ = register(anon_client, ADMIN)
    google_token, _ = make_google_only_user(db_session_factory, "gina@example.com")

    alice = anon_client.get("/api/auth/me", headers=bearer(token)).json()
    boss = anon_client.get("/api/auth/me", headers=bearer(boss_token)).json()
    gina = anon_client.get("/api/auth/me", headers=bearer(google_token)).json()

    assert (alice["is_admin"], alice["has_password"]) == (False, True)
    assert (boss["is_admin"], boss["has_password"]) == (True, True)
    assert (gina["is_admin"], gina["has_password"]) == (False, False)
    assert set(alice) == {"id", "email", "is_admin", "has_password"}


def test_no_field_in_a_request_can_make_an_account_an_administrator(anon_client, admins):
    resp = anon_client.post(
        "/api/auth/register", json={"email": "mallory@example.com", "password": PASSWORD, "is_admin": True}
    )

    assert resp.json()["user"]["is_admin"] is False


# ------------------------------------------------------- delete my account


def test_a_user_can_delete_their_own_account_with_their_password(anon_client, db_session_factory):
    token, user_id = register(anon_client, "alice@example.com")

    resp = delete_me(anon_client, token, PASSWORD)

    assert resp.status_code == 204 and resp.content == b""
    assert not user_exists(db_session_factory, user_id)


def test_deleting_an_account_deletes_its_trips_days_and_activities_and_only_those(anon_client, db_session_factory):
    alice, _ = register(anon_client, "alice@example.com")
    bob, bob_id = register(anon_client, "bob@example.com")
    make_trip_with_activity(anon_client, alice)
    make_trip_with_activity(anon_client, bob)
    assert counts(db_session_factory) == {"users": 2, "trips": 2, "days": 2, "activities": 2}

    assert delete_me(anon_client, alice, PASSWORD).status_code == 204

    assert counts(db_session_factory) == {"users": 1, "trips": 1, "days": 1, "activities": 1}
    assert user_exists(db_session_factory, bob_id)


def test_the_share_link_of_a_deleted_accounts_trip_answers_like_an_unknown_one(anon_client):
    token, _ = register(anon_client, "alice@example.com")
    trip = make_trip_with_activity(anon_client, token)
    share = anon_client.post(f"/api/trips/{trip['id']}/share", headers=bearer(token)).json()["share_token"]
    assert anon_client.get(f"/api/share/{share}").status_code == 200

    delete_me(anon_client, token, PASSWORD)

    gone = anon_client.get(f"/api/share/{share}")
    unknown = anon_client.get("/api/share/no-such-token")
    assert gone.status_code == 404
    assert gone.json() == unknown.json()


def test_a_wrong_password_deletes_nothing_and_is_403_confirmation_failed(anon_client, db_session_factory):
    token, user_id = register(anon_client, "alice@example.com")

    resp = delete_me(anon_client, token, WRONG)

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "confirmation_failed"
    assert resp.json()["error"]["message"] == "That doesn't match. Nothing was deleted."
    assert user_exists(db_session_factory, user_id)
    assert anon_client.get("/api/auth/me", headers=bearer(token)).status_code == 200  # still logged in


def test_a_missing_or_empty_confirmation_deletes_nothing(anon_client, db_session_factory):
    token, user_id = register(anon_client, "alice@example.com")

    no_body = anon_client.request("DELETE", "/api/auth/me", json={}, headers=bearer(token))
    empty = delete_me(anon_client, token, "")

    assert no_body.status_code == 422
    assert empty.status_code == 403
    assert user_exists(db_session_factory, user_id)


def test_a_password_less_account_confirms_with_its_own_email(anon_client, db_session_factory):
    token, user_id = make_google_only_user(db_session_factory, "gina@example.com")

    assert delete_me(anon_client, token, "").status_code == 403
    assert delete_me(anon_client, token, PASSWORD).status_code == 403
    assert delete_me(anon_client, token, "someone-else@example.com").status_code == 403
    assert user_exists(db_session_factory, user_id)

    assert delete_me(anon_client, token, "  Gina@Example.com ").status_code == 204  # case and spaces do not matter
    assert not user_exists(db_session_factory, user_id)


# ------------------------------------------------------------ rate limit


def test_wrong_passwords_count_as_failed_logins_and_then_even_the_right_one_is_refused(anon_client, db_session_factory):
    token, user_id = register(anon_client, "alice@example.com")
    for _ in range(3):
        assert delete_me(anon_client, token, WRONG).status_code == 403

    resp = delete_me(anon_client, token, PASSWORD)

    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "too_many_attempts"
    assert re.fullmatch(r"Too many attempts\. Try again in \d+ minutes?\.", resp.json()["error"]["message"])
    assert int(resp.headers["Retry-After"]) >= 1
    assert user_exists(db_session_factory, user_id)


def test_failed_logins_and_failed_deletions_share_one_count(anon_client, db_session_factory):
    token, user_id = register(anon_client, "alice@example.com")
    assert login(anon_client, "alice@example.com", WRONG).status_code == 401
    assert login(anon_client, "alice@example.com", WRONG).status_code == 401
    assert delete_me(anon_client, token, WRONG).status_code == 403  # the third failure, in total

    assert delete_me(anon_client, token, PASSWORD).status_code == 429
    assert login(anon_client, "alice@example.com", PASSWORD).status_code == 429
    assert user_exists(db_session_factory, user_id)


def test_the_lock_is_per_caller_address(anon_client):
    token, _ = register(anon_client, "alice@example.com")
    for _ in range(3):
        delete_me(anon_client, token, WRONG, address="203.0.113.7")

    assert delete_me(anon_client, token, PASSWORD, address="203.0.113.7").status_code == 429
    assert delete_me(anon_client, token, PASSWORD, address="198.51.100.99").status_code == 204


# ------------------------------------------------------- after deletion


def test_after_deletion_the_token_is_refused_and_the_email_can_register_again(anon_client):
    token, _ = register(anon_client, "alice@example.com")

    delete_me(anon_client, token, PASSWORD)

    assert anon_client.get("/api/auth/me", headers=bearer(token)).status_code == 401
    assert anon_client.get("/api/trips", headers=bearer(token)).status_code == 401
    assert login(anon_client, "alice@example.com", PASSWORD).status_code == 401
    register(anon_client, "alice@example.com")  # asserts 201


# ------------------------------------------------------------ admin role


def test_an_administrator_lists_all_accounts_with_trip_counts_and_nothing_secret(anon_client, admins, db_session_factory):
    alice, alice_id = register(anon_client, "alice@example.com")
    _, bob_id = register(anon_client, "bob@example.com")
    boss, boss_id = register(anon_client, ADMIN)
    make_trip_with_activity(anon_client, alice, "One")
    make_trip_with_activity(anon_client, alice, "Two")
    _, gina_id = make_google_only_user(db_session_factory, "gina@example.com")

    resp = anon_client.get("/api/admin/users", headers=bearer(boss))

    assert resp.status_code == 200
    users = resp.json()["users"]
    assert [u["id"] for u in users] == [alice_id, bob_id, boss_id, gina_id]  # oldest first
    assert all(set(u) == {"id", "email", "created_at", "trip_count", "is_admin"} for u in users)
    assert {u["email"]: u["trip_count"] for u in users} == {
        "alice@example.com": 2, "bob@example.com": 0, ADMIN: 0, "gina@example.com": 0,
    }
    assert {u["email"]: u["is_admin"] for u in users}[ADMIN] is True
    assert all(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|\+00:00)", u["created_at"]) for u in users)
    flat = resp.text
    assert "password" not in flat and "scrypt" not in flat and "google" not in flat and "Hike" not in flat


def test_a_non_administrator_is_refused_the_admin_endpoints_and_nothing_changes(anon_client, admins, db_session_factory):
    alice, _ = register(anon_client, "alice@example.com")
    _, bob_id = register(anon_client, "bob@example.com")
    before = counts(db_session_factory)

    listing = anon_client.get("/api/admin/users", headers=bearer(alice))
    deletion = anon_client.delete(f"/api/admin/users/{bob_id}", headers=bearer(alice))

    for resp in (listing, deletion):
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "forbidden"
    assert counts(db_session_factory) == before


def test_an_administrator_can_delete_another_account_and_its_trips(anon_client, admins, db_session_factory):
    alice, alice_id = register(anon_client, "alice@example.com")
    boss, _ = register(anon_client, ADMIN)
    make_trip_with_activity(anon_client, alice)

    resp = anon_client.delete(f"/api/admin/users/{alice_id}", headers=bearer(boss))

    assert resp.status_code == 204 and resp.content == b""
    assert counts(db_session_factory) == {"users": 1, "trips": 0, "days": 0, "activities": 0}
    assert anon_client.get("/api/auth/me", headers=bearer(alice)).status_code == 401


def test_deleting_an_account_that_does_not_exist_is_404_user_not_found(anon_client, admins):
    boss, _ = register(anon_client, ADMIN)

    resp = anon_client.delete("/api/admin/users/9999", headers=bearer(boss))

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "user_not_found"


def test_an_administrator_account_cannot_be_deleted_by_an_administrator_or_by_its_owner(anon_client, admins, db_session_factory):
    boss, boss_id = register(anon_client, ADMIN)
    other, other_id = register(anon_client, "other-admin@example.com")

    by_other_admin = anon_client.delete(f"/api/admin/users/{boss_id}", headers=bearer(other))
    by_itself = anon_client.delete(f"/api/admin/users/{boss_id}", headers=bearer(boss))
    by_owner = delete_me(anon_client, boss, PASSWORD)

    for resp in (by_other_admin, by_itself, by_owner):
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "admin_account_protected"
    assert user_exists(db_session_factory, boss_id) and user_exists(db_session_factory, other_id)


def test_an_account_becomes_deletable_once_its_address_leaves_the_admin_list(anon_client, monkeypatch, db_session_factory):
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    boss, boss_id = register(anon_client, ADMIN)
    assert delete_me(anon_client, boss, PASSWORD).status_code == 409

    monkeypatch.setenv("ADMIN_EMAILS", "somebody-else@example.com")

    assert delete_me(anon_client, boss, PASSWORD).status_code == 204
    assert not user_exists(db_session_factory, boss_id)


def test_admin_rights_follow_the_current_setting_on_every_request(anon_client, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "  BOSS@Example.COM ,x@y.zz")
    boss, _ = register(anon_client, ADMIN)  # case and surrounding spaces do not matter
    assert anon_client.get("/api/admin/users", headers=bearer(boss)).status_code == 200

    monkeypatch.setenv("ADMIN_EMAILS", "")
    assert anon_client.get("/api/admin/users", headers=bearer(boss)).status_code == 403  # same token, rights gone

    monkeypatch.delenv("ADMIN_EMAILS")
    assert anon_client.get("/api/admin/users", headers=bearer(boss)).status_code == 403  # unset: nobody

    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    assert anon_client.get("/api/admin/users", headers=bearer(boss)).status_code == 200  # and back
    assert anon_client.get("/api/auth/me", headers=bearer(boss)).json()["is_admin"] is True


def test_with_no_admin_setting_nobody_is_an_administrator(anon_client, monkeypatch):
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    token, _ = register(anon_client, ADMIN)

    assert anon_client.get("/api/admin/users", headers=bearer(token)).status_code == 403


# ---------------------------------------------------------------- logging


def test_every_deletion_is_logged_with_who_did_it_and_to_whom(anon_client, admins, caplog):
    alice, alice_id = register(anon_client, "alice@example.com")
    bob, bob_id = register(anon_client, "bob@example.com")
    boss, boss_id = register(anon_client, ADMIN)

    with caplog.at_level(logging.INFO, logger="trip_planner.accounts"):
        delete_me(anon_client, alice, PASSWORD)
        anon_client.delete(f"/api/admin/users/{bob_id}", headers=bearer(boss))

    messages = [r.getMessage() for r in caplog.records if r.name == "trip_planner.accounts"]
    assert len(messages) == 2
    assert f"actor_id={alice_id}" in messages[0] and f"deleted_id={alice_id}" in messages[0]
    assert "alice@example.com" in messages[0]
    assert f"actor_id={boss_id}" in messages[1] and f"deleted_id={bob_id}" in messages[1]
    assert ADMIN in messages[1] and "bob@example.com" in messages[1]


def test_a_refused_deletion_is_not_logged_as_a_deletion(anon_client, caplog):
    token, _ = register(anon_client, "alice@example.com")

    with caplog.at_level(logging.INFO, logger="trip_planner.accounts"):
        delete_me(anon_client, token, WRONG)

    assert [r for r in caplog.records if r.name == "trip_planner.accounts"] == []
