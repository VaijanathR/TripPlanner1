"""Authentication: password hashing, login tokens, Google ID-token checks.

Passwords are hashed with the stdlib's scrypt (no extra dependency). A login
returns a short-lived signed token that the frontend sends as
`Authorization: Bearer <token>` -- a header rather than a cookie, because the
frontend and API live on different domains and browsers block cross-site
cookies. Tokens are stateless, so "log out" is client-side; they simply expire.

Config comes from the environment and is read here only:
  JWT_SECRET        required; >= 32 chars; signs login tokens
  ADMIN_EMAILS      optional; comma-separated administrator email addresses
  GOOGLE_CLIENT_ID  optional; enables Google sign-in when set
"""

import base64
import datetime
import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import models
from database import get_db
from errors import AppError

ACCESS_TOKEN_TTL = datetime.timedelta(days=7)
JWT_ALGORITHM = "HS256"
MIN_JWT_SECRET_LENGTH = 32

# scrypt cost: ~16 MiB and a few tens of ms per hash -- gentle enough for the
# free-tier App Service, still costly for someone guessing offline.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]


def unauthenticated() -> AppError:
    return AppError(401, "unauthenticated", "Authentication required")


# -- config ------------------------------------------------------------------


def get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if len(secret) < MIN_JWT_SECRET_LENGTH:
        raise RuntimeError(
            f"JWT_SECRET must be set to at least {MIN_JWT_SECRET_LENGTH} characters"
        )
    return secret


def google_client_id() -> str | None:
    return os.environ.get("GOOGLE_CLIENT_ID") or None


# -- passwords ---------------------------------------------------------------


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        password.encode(), salt=salt, n=n, r=r, p=p, dklen=32, maxmem=_SCRYPT_MAXMEM
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = _scrypt(password, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
    b64 = lambda raw: base64.b64encode(raw).decode()
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time check. A missing hash still costs one scrypt, so login
    time doesn't reveal whether an email has a password account."""
    if not stored:
        _scrypt(password, b"\0" * 16, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
        return False
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest_b64)
        actual = _scrypt(password, base64.b64decode(salt_b64), int(n), int(r), int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


# -- login tokens ------------------------------------------------------------


def create_access_token(user: models.User) -> str:
    now = datetime.datetime.now(datetime.UTC)
    claims = {"sub": str(user.id), "iat": now, "exp": now + ACCESS_TOKEN_TTL}
    return jwt.encode(claims, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> int:
    """Returns the user id, or raises the 401 for any invalid/expired token."""
    try:
        claims = jwt.decode(
            token, get_jwt_secret(), algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub"]}
        )
        return int(claims["sub"])
    except (jwt.PyJWTError, ValueError, TypeError):
        raise unauthenticated() from None


_bearer = HTTPBearer(auto_error=False)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    if credentials is None:
        raise unauthenticated()
    user = db.get(models.User, decode_access_token(credentials.credentials))
    if user is None:
        raise unauthenticated()
    return user


def admin_emails() -> set[str]:
    """The administrators' addresses, read on every call (never cached) so a change
    to the setting takes effect at once. Case and surrounding spaces don't matter."""
    return {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}


def is_admin(user: models.User) -> bool:
    return user.email.strip().lower() in admin_emails()


def require_admin(user: models.User = Depends(current_user)) -> models.User:
    if not is_admin(user):
        raise AppError(403, "forbidden", "Administrator access is required")
    return user


# -- Google ------------------------------------------------------------------


@dataclass
class GoogleIdentity:
    sub: str
    email: str


class GoogleTokenInvalid(Exception):
    """The credential is forged, expired, for another app, or unverified."""


class GoogleUnavailable(Exception):
    """Google's signing keys couldn't be fetched."""


_jwks_client: jwt.PyJWKClient | None = None


def _google_keys() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(GOOGLE_JWKS_URL, timeout=5)
    return _jwks_client


def verify_google_id_token(credential: str) -> GoogleIdentity:
    """Checks signature (against Google's published keys), audience, issuer,
    expiry, and that Google itself verified the email."""
    client_id = google_client_id()
    if client_id is None:
        raise GoogleUnavailable("GOOGLE_CLIENT_ID is not set")
    try:
        signing_key = _google_keys().get_signing_key_from_jwt(credential)
        claims = jwt.decode(
            credential,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=GOOGLE_ISSUERS,
            options={"require": ["exp", "iat", "sub", "email"]},
        )
    except jwt.PyJWKClientConnectionError as exc:
        raise GoogleUnavailable(str(exc)) from exc
    except jwt.PyJWTError as exc:
        raise GoogleTokenInvalid(str(exc)) from exc

    if claims.get("email_verified") is not True:
        raise GoogleTokenInvalid("email is not verified by Google")
    return GoogleIdentity(sub=str(claims["sub"]), email=str(claims["email"]).lower())
