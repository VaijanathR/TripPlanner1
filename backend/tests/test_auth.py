"""Accounts: registration, login, login tokens, Google sign-in."""

import datetime

import jwt
import pytest

import auth
import models

PASSWORD = "correct-horse-battery"


def _register(client, email="alice@example.com", password=PASSWORD):
    return client.post("/api/auth/register", json={"email": email, "password": password})


# ---------------------------------------------------------------- registration


def test_register_returns_a_working_token_and_the_user(anon_client):
    resp = _register(anon_client)

    assert resp.status_code == 201
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "alice@example.com"
    assert set(body["user"]) == {"id", "email"}  # no hash, no google id
    me = anon_client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json() == body["user"]


def test_register_normalises_the_email(anon_client):
    resp = _register(anon_client, email="  Alice@Example.COM ")

    assert resp.json()["user"]["email"] == "alice@example.com"


def test_register_stores_a_salted_hash_never_the_password(anon_client, db_session_factory):
    _register(anon_client)
    _register(anon_client, email="bob@example.com")

    with db_session_factory() as db:
        hashes = [u.password_hash for u in db.query(models.User).order_by(models.User.id)]
    assert all(h.startswith("scrypt$") and PASSWORD not in h for h in hashes)
    assert hashes[0] != hashes[1]  # same password, different salt


def test_register_rejects_a_duplicate_email_case_insensitively(anon_client):
    _register(anon_client, email="alice@example.com")

    resp = _register(anon_client, email="ALICE@example.com")

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "email_taken"


@pytest.mark.parametrize("email", ["", "not-an-email", "a@b", "two@@example.com", "spa ce@example.com"])
def test_register_rejects_an_invalid_email(anon_client, email):
    resp = _register(anon_client, email=email)

    assert resp.status_code == 422
    assert "email" in resp.json()["error"]["fields"]


@pytest.mark.parametrize("password", ["", "short", "x" * 7, "x" * 129])
def test_register_rejects_a_password_outside_the_length_bounds(anon_client, password):
    resp = _register(anon_client, password=password)

    assert resp.status_code == 422
    assert "password" in resp.json()["error"]["fields"]


# ----------------------------------------------------------------------- login


def test_login_with_the_right_password_returns_a_working_token(anon_client):
    _register(anon_client)

    resp = anon_client.post("/api/auth/login", json={"email": "Alice@example.com", "password": PASSWORD})

    assert resp.status_code == 200
    me = anon_client.get("/api/auth/me", headers={"Authorization": f"Bearer {resp.json()['access_token']}"})
    assert me.json()["email"] == "alice@example.com"


def test_login_gives_the_same_401_for_a_wrong_password_and_an_unknown_email(anon_client):
    _register(anon_client)

    wrong_password = anon_client.post("/api/auth/login", json={"email": "alice@example.com", "password": "nope-nope-nope"})
    unknown_email = anon_client.post("/api/auth/login", json={"email": "ghost@example.com", "password": PASSWORD})

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert wrong_password.json()["error"]["code"] == "invalid_credentials"


def test_login_gives_the_same_401_for_an_account_that_has_no_password(anon_client, db_session_factory):
    with db_session_factory() as db:
        db.add(models.User(email="google-only@example.com", google_sub="sub-1"))
        db.commit()

    resp = anon_client.post("/api/auth/login", json={"email": "google-only@example.com", "password": PASSWORD})

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_credentials"


# ---------------------------------------------------------------------- tokens


def _token_for(client, **claim_overrides):
    user_id = _register(client).json()["user"]["id"]
    now = datetime.datetime.now(datetime.UTC)
    claims = {"sub": str(user_id), "iat": now, "exp": now + datetime.timedelta(hours=1), **claim_overrides}
    return {k: v for k, v in claims.items() if v is not None}


def _get_me(client, token):
    return client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})


def test_me_requires_a_token(anon_client):
    resp = anon_client.get("/api/auth/me")

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthenticated"


@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer not.a.jwt", "token abc", ""])
def test_a_malformed_authorization_header_is_rejected(anon_client, header):
    resp = anon_client.get("/api/auth/me", headers={"Authorization": header})

    assert resp.status_code == 401


def test_an_expired_token_is_rejected(anon_client):
    claims = _token_for(anon_client)
    claims["exp"] = datetime.datetime.now(datetime.UTC) - datetime.timedelta(seconds=5)

    assert _get_me(anon_client, jwt.encode(claims, auth.get_jwt_secret(), algorithm="HS256")).status_code == 401


def test_a_token_signed_with_another_secret_is_rejected(anon_client):
    claims = _token_for(anon_client)

    forged = jwt.encode(claims, "some-other-secret-that-is-long-enough-1234", algorithm="HS256")

    assert _get_me(anon_client, forged).status_code == 401


def test_a_token_with_a_tampered_payload_is_rejected(anon_client):
    good = jwt.encode(_token_for(anon_client), auth.get_jwt_secret(), algorithm="HS256")
    header, _payload, signature = good.split(".")
    other_payload = jwt.encode({"sub": "999", "exp": 9999999999}, "x" * 40, algorithm="HS256").split(".")[1]

    assert _get_me(anon_client, f"{header}.{other_payload}.{signature}").status_code == 401


def test_an_unsigned_token_is_rejected(anon_client):
    unsigned = jwt.encode(_token_for(anon_client), None, algorithm="none")

    assert _get_me(anon_client, unsigned).status_code == 401


@pytest.mark.parametrize("missing", ["sub", "exp"])
def test_a_token_missing_a_required_claim_is_rejected(anon_client, missing):
    claims = _token_for(anon_client, **{missing: None})

    assert _get_me(anon_client, jwt.encode(claims, auth.get_jwt_secret(), algorithm="HS256")).status_code == 401


def test_a_valid_token_for_a_user_that_no_longer_exists_is_rejected(anon_client):
    claims = _token_for(anon_client, sub="424242")

    assert _get_me(anon_client, jwt.encode(claims, auth.get_jwt_secret(), algorithm="HS256")).status_code == 401


def test_a_non_numeric_subject_is_rejected(anon_client):
    claims = _token_for(anon_client, sub="alice")

    assert _get_me(anon_client, jwt.encode(claims, auth.get_jwt_secret(), algorithm="HS256")).status_code == 401


# --------------------------------------------------------- passwords + secrets


def test_password_hashes_verify_only_the_right_password():
    stored = auth.hash_password(PASSWORD)

    assert auth.verify_password(PASSWORD, stored)
    assert not auth.verify_password(PASSWORD + "x", stored)
    assert auth.hash_password(PASSWORD) != stored


@pytest.mark.parametrize("stored", [None, "", "garbage", "scrypt$1$2$3", "bcrypt$1$1$1$AA==$AA==", "scrypt$x$y$z$!!$!!"])
def test_a_missing_or_malformed_stored_hash_never_verifies(stored):
    assert auth.verify_password(PASSWORD, stored) is False


@pytest.mark.parametrize("secret", [None, "", "too-short"])
def test_the_app_refuses_to_run_without_a_long_enough_jwt_secret(monkeypatch, secret):
    if secret is None:
        monkeypatch.delenv("JWT_SECRET")
    else:
        monkeypatch.setenv("JWT_SECRET", secret)

    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        auth.get_jwt_secret()


def test_importing_the_app_without_a_jwt_secret_fails_at_startup():
    """A deploy with the secret unset must crash loudly, not serve unsigned logins."""
    import os
    import pathlib
    import subprocess
    import sys

    backend = pathlib.Path(__file__).resolve().parent.parent
    env = {k: v for k, v in os.environ.items() if k != "JWT_SECRET"}

    result = subprocess.run(
        [sys.executable, "-c", "import main"], cwd=backend, env=env, capture_output=True, text=True
    )

    assert result.returncode != 0
    assert "JWT_SECRET" in result.stderr
