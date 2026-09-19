"""Google sign-in: the endpoint's account logic, and the token verifier itself."""

import datetime
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

import auth
import models

CLIENT_ID = "1234567890-abc.apps.googleusercontent.com"


@pytest.fixture(autouse=True)
def google_configured(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)


def _sign_in(anon_client, monkeypatch, sub="g-sub-1", email="dana@example.com"):
    """Sign in with the Google verifier stubbed to return this identity."""
    monkeypatch.setattr(auth, "verify_google_id_token", lambda _c: auth.GoogleIdentity(sub=sub, email=email))
    return anon_client.post("/api/auth/google", json={"credential": "stub"})


def _me(client, resp):
    return client.get("/api/auth/me", headers={"Authorization": f"Bearer {resp.json()['access_token']}"})


# -------------------------------------------------------------------- endpoint


def test_first_google_sign_in_creates_an_account_and_returns_a_working_token(anon_client, monkeypatch):
    resp = _sign_in(anon_client, monkeypatch)

    assert resp.status_code == 200
    assert resp.json()["user"]["email"] == "dana@example.com"
    assert _me(anon_client, resp).json()["email"] == "dana@example.com"


def test_signing_in_again_with_google_returns_the_same_account(anon_client, monkeypatch):
    first = _sign_in(anon_client, monkeypatch)
    second = _sign_in(anon_client, monkeypatch)

    assert first.json()["user"]["id"] == second.json()["user"]["id"]


def test_a_google_only_account_cannot_log_in_with_a_password(anon_client, monkeypatch):
    _sign_in(anon_client, monkeypatch)

    resp = anon_client.post("/api/auth/login", json={"email": "dana@example.com", "password": "anything-at-all"})

    assert resp.status_code == 401


def test_google_email_matching_a_password_account_links_it_keeps_its_trips_and_drops_the_password(
    anon_client, monkeypatch
):
    reg = anon_client.post("/api/auth/register", json={"email": "dana@example.com", "password": "correct-horse-battery"})
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    anon_client.post("/api/trips", json={"name": "Dana's trip"}, headers=headers)

    google = _sign_in(anon_client, monkeypatch)

    assert google.json()["user"]["id"] == reg.json()["user"]["id"]
    trips = anon_client.get("/api/trips", headers={"Authorization": f"Bearer {google.json()['access_token']}"})
    assert [t["name"] for t in trips.json()["trips"]] == ["Dana's trip"]
    # The password is gone: whoever pre-registered this address without
    # proving they own it must not keep access once the real owner arrives.
    old_login = anon_client.post("/api/auth/login", json={"email": "dana@example.com", "password": "correct-horse-battery"})
    assert old_login.status_code == 401


def test_an_email_already_tied_to_a_different_google_identity_is_never_re_pointed(anon_client, monkeypatch):
    _sign_in(anon_client, monkeypatch, sub="original-sub")

    resp = _sign_in(anon_client, monkeypatch, sub="different-sub")

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_google_token"


def test_an_invalid_google_credential_is_rejected(anon_client, monkeypatch):
    def reject(_credential):
        raise auth.GoogleTokenInvalid("bad")

    monkeypatch.setattr(auth, "verify_google_id_token", reject)

    resp = anon_client.post("/api/auth/google", json={"credential": "forged"})

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_google_token"


def test_google_being_unreachable_is_a_503_not_a_login_failure(anon_client, monkeypatch):
    def unreachable(_credential):
        raise auth.GoogleUnavailable("no route to host")

    monkeypatch.setattr(auth, "verify_google_id_token", unreachable)

    resp = anon_client.post("/api/auth/google", json={"credential": "x"})

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "google_unavailable"


def test_google_sign_in_is_off_when_no_client_id_is_configured(anon_client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID")

    resp = anon_client.post("/api/auth/google", json={"credential": "x"})

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "google_unavailable"


def test_an_empty_google_credential_is_a_validation_error(anon_client):
    assert anon_client.post("/api/auth/google", json={"credential": ""}).status_code == 422


# ------------------------------------------------------------------- verifier
# These use real RSA signatures, so signature/audience/issuer/expiry checking
# is exercised for real -- only the fetch of Google's public keys is faked.


@pytest.fixture(scope="module")
def keypair():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture()
def google_keys(monkeypatch, keypair):
    class _SigningKey:
        key = keypair.public_key()

    class _Keys:
        def get_signing_key_from_jwt(self, _token):
            return _SigningKey()

    monkeypatch.setattr(auth, "_google_keys", lambda: _Keys())


def _id_token(private_key, **overrides):
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "g-sub-1",
        "email": "Dana@Example.com",
        "email_verified": True,
        "iat": now,
        "exp": now + 3600,
        **overrides,
    }
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, private_key, algorithm="RS256")


def test_a_valid_google_id_token_yields_the_identity_with_a_lowercased_email(google_keys, keypair):
    identity = auth.verify_google_id_token(_id_token(keypair))

    assert identity == auth.GoogleIdentity(sub="g-sub-1", email="dana@example.com")


def test_the_alternate_google_issuer_form_is_accepted(google_keys, keypair):
    auth.verify_google_id_token(_id_token(keypair, iss="accounts.google.com"))


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "someone-elses-app.apps.googleusercontent.com"},
        {"iss": "https://evil.example.com"},
        {"exp": int(time.time()) - 60},
        {"email_verified": False},
        {"email_verified": "true"},  # a string is not Google's boolean true
        {"email_verified": None},
        {"email": None},
        {"sub": None},
    ],
    ids=["wrong-audience", "wrong-issuer", "expired", "unverified-email", "string-verified", "no-verified-claim", "no-email", "no-sub"],
)
def test_a_bad_google_id_token_is_rejected(google_keys, keypair, overrides):
    with pytest.raises(auth.GoogleTokenInvalid):
        auth.verify_google_id_token(_id_token(keypair, **overrides))


def test_a_token_signed_by_someone_other_than_google_is_rejected(google_keys):
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    with pytest.raises(auth.GoogleTokenInvalid):
        auth.verify_google_id_token(_id_token(attacker_key))


def test_an_hs256_token_cannot_be_passed_off_as_a_google_rs256_token(google_keys, keypair):
    """The classic algorithm-confusion attack: sign with HS256 using the public key as the secret."""
    forged = jwt.encode(
        {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "x", "email": "a@b.co",
         "email_verified": True, "iat": int(time.time()), "exp": int(time.time()) + 60},
        "public-key-bytes-as-secret-0123456789", algorithm="HS256",
    )

    with pytest.raises(auth.GoogleTokenInvalid):
        auth.verify_google_id_token(forged)


def test_an_unreachable_key_endpoint_is_reported_as_unavailable_not_invalid(monkeypatch, keypair):
    class _Broken:
        def get_signing_key_from_jwt(self, _token):
            raise jwt.PyJWKClientConnectionError("timed out")

    monkeypatch.setattr(auth, "_google_keys", lambda: _Broken())

    with pytest.raises(auth.GoogleUnavailable):
        auth.verify_google_id_token(_id_token(keypair))


def test_verification_is_unavailable_when_no_client_id_is_set(monkeypatch, keypair):
    monkeypatch.delenv("GOOGLE_CLIENT_ID")

    with pytest.raises(auth.GoogleUnavailable):
        auth.verify_google_id_token(_id_token(keypair))
