"""Rate limiting for the public sign-in endpoints.

Implements specs/api-contract.md "Rate limits" and specs/backend-spec.md
"Rate limiting". Attempts are stored in the database (so limits survive a
restart) as SHA-256 hashes of the email and the caller address -- never the raw
values.

Design points worth knowing when reading the code:
- Sliding windows: a lock ends when the oldest counted attempt is older than the
  window.
- A login attempt is *reserved* (recorded as a failure) BEFORE its password is
  checked, and un-recorded if the password turns out to be right. Recording only
  after the check would let a burst of parallel guesses all slip past the limit.
- Attempts refused because of a lock are not recorded, so hammering a locked
  account cannot extend the lock.
- If the attempts table can't be read or written, the request goes ahead and the
  problem is logged (the limit is briefly not enforced). Refusing logins because
  of a database hiccup was judged worse.
"""

import datetime
import hashlib
import logging
import math
import threading
from contextlib import contextmanager
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

import models
from database import get_db
from errors import AppError

log = logging.getLogger("trip_planner.ratelimit")

WINDOW_SHORT = datetime.timedelta(minutes=15)
WINDOW_LONG = datetime.timedelta(hours=1)

LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS = 3  # R1, per WINDOW_SHORT
LOGIN_FAILURES_PER_ADDRESS = 30  # R2, per WINDOW_SHORT
SIGNUPS_PER_ADDRESS = 10  # R3, per WINDOW_LONG
GOOGLE_ATTEMPTS_PER_ADDRESS = 20  # R4, per WINDOW_SHORT

LOGIN_FAILURE, SIGNUP, GOOGLE = "login_failure", "signup", "google"

# Old records are deleted, at most this often; they are kept twice the longest window.
PURGE_EVERY = datetime.timedelta(minutes=10)
PURGE_AFTER = 2 * WINDOW_LONG

_lock = threading.Lock()  # makes "count, then record" atomic within this process
_last_purge: datetime.datetime | None = None


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _aware(moment: datetime.datetime) -> datetime.datetime:
    return moment.replace(tzinfo=datetime.UTC) if moment.tzinfo is None else moment


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def client_address(request: Request) -> str:
    """The caller's address: the LAST entry of X-Forwarded-For -- the one the
    hosting platform (Azure App Service) appends -- because earlier entries are
    whatever the caller chose to send. Without that header, the connection's own
    address. Ports ("1.2.3.4:5678", "[::1]:443") are removed."""
    header = request.headers.get("x-forwarded-for", "")
    entries = [e.strip() for e in header.split(",") if e.strip()]
    if entries:
        entry = entries[-1]
        if entry.startswith("["):  # [ipv6]:port
            return entry[1:].split("]", 1)[0]
        if entry.count(":") == 1:  # ipv4:port
            return entry.split(":", 1)[0]
        return entry  # bare IPv4, or IPv6 without a port
    return request.client.host if request.client else "unknown"


@dataclass
class Reservation:
    row_id: int
    email_hash: str
    address_hash: str


def _too_many(seconds: int) -> AppError:
    minutes = max(1, math.ceil(seconds / 60))
    unit = "minute" if minutes == 1 else "minutes"
    return AppError(
        429,
        "too_many_attempts",
        f"Too many attempts. Try again in {minutes} {unit}.",
        headers={"Retry-After": str(seconds)},
    )


@contextmanager
def _session(db: Session):
    """A short session of our own, so recording an attempt commits at once and
    a failure here can never leave the request's own session unusable."""
    session = sessionmaker(bind=db.get_bind(), autoflush=False)()
    try:
        yield session
    finally:
        session.close()


def _attempt_times(session, kind, window, now, *, address_hash, email_hash=None) -> list[datetime.datetime]:
    query = select(models.AuthAttempt.created_at).where(
        models.AuthAttempt.kind == kind,
        models.AuthAttempt.address_hash == address_hash,
        models.AuthAttempt.created_at > now - window,
    )
    if email_hash is not None:
        query = query.where(models.AuthAttempt.email_hash == email_hash)
    return sorted(_aware(t) for t in session.scalars(query))


def _seconds_until_free(times: list[datetime.datetime], limit: int, window, now) -> int:
    """How long until fewer than `limit` attempts are still inside the window."""
    frees_at = times[len(times) - limit] + window
    return max(1, math.ceil((frees_at - now).total_seconds()))


def _purge_if_due(session, now) -> None:
    global _last_purge
    if _last_purge is not None and now - _last_purge < PURGE_EVERY:
        return
    session.execute(delete(models.AuthAttempt).where(models.AuthAttempt.created_at < now - PURGE_AFTER))
    session.commit()
    _last_purge = now


def _record(session, kind, now, *, address_hash, email_hash=None) -> models.AuthAttempt:
    row = models.AuthAttempt(kind=kind, email_hash=email_hash, address_hash=address_hash, created_at=now)
    session.add(row)
    session.commit()
    return row


# -- login (R1, R2) -----------------------------------------------------------


def reserve_login_attempt(db: Session, request: Request, email: str) -> Reservation | None:
    """Call BEFORE checking the password. Raises 429 if R1 or R2 is exceeded;
    otherwise records the attempt as a failure until `release_login_success`.
    Returns None if the limiter could not run (fail open)."""
    email_hash = sha256(normalize_email(email))
    address_hash = sha256(client_address(request))
    blocked_for = 0
    reservation = None
    try:
        with _lock, _session(db) as session:
            now = _now()
            _purge_if_due(session, now)
            pair = _attempt_times(session, LOGIN_FAILURE, WINDOW_SHORT, now, address_hash=address_hash, email_hash=email_hash)
            everything = _attempt_times(session, LOGIN_FAILURE, WINDOW_SHORT, now, address_hash=address_hash)
            waits = []
            if len(pair) >= LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS:
                waits.append(_seconds_until_free(pair, LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS, WINDOW_SHORT, now))
            if len(everything) >= LOGIN_FAILURES_PER_ADDRESS:
                waits.append(_seconds_until_free(everything, LOGIN_FAILURES_PER_ADDRESS, WINDOW_SHORT, now))
            if waits:
                blocked_for = max(waits)  # refused attempts are NOT recorded: hammering can't extend a lock
            else:
                row = _record(session, LOGIN_FAILURE, now, address_hash=address_hash, email_hash=email_hash)
                reservation = Reservation(row.id, email_hash, address_hash)
    except Exception:
        log.exception("rate limiter unavailable; letting the login attempt through")
        return None
    if blocked_for:
        raise _too_many(blocked_for)
    return reservation


def release_login_success(db: Session, reservation: Reservation | None) -> None:
    """The password was right: this attempt is not a failure, and that email's
    failures from this address are forgotten (R1)."""
    if reservation is None:
        return
    try:
        with _lock, _session(db) as session:
            session.execute(
                delete(models.AuthAttempt).where(
                    models.AuthAttempt.kind == LOGIN_FAILURE,
                    models.AuthAttempt.email_hash == reservation.email_hash,
                    models.AuthAttempt.address_hash == reservation.address_hash,
                )
            )
            session.commit()
    except Exception:
        log.exception("rate limiter unavailable; could not clear a successful login's failures")


# -- sign-up (R3) and Google (R4) ------------------------------------------------


def _admit(db: Session, request: Request, kind: str, limit: int, window: datetime.timedelta) -> None:
    address_hash = sha256(client_address(request))
    blocked_for = 0
    try:
        with _lock, _session(db) as session:
            now = _now()
            _purge_if_due(session, now)
            times = _attempt_times(session, kind, window, now, address_hash=address_hash)
            if len(times) >= limit:
                blocked_for = _seconds_until_free(times, limit, window, now)
            else:
                _record(session, kind, now, address_hash=address_hash)
    except Exception:
        log.exception("rate limiter unavailable; letting the %s attempt through", kind)
        return
    if blocked_for:
        raise _too_many(blocked_for)


def limit_signup(request: Request, db: Session = Depends(get_db)) -> None:
    """FastAPI dependency for POST /api/auth/register (R3). Counts every attempt,
    including ones that later fail validation."""
    _admit(db, request, SIGNUP, SIGNUPS_PER_ADDRESS, WINDOW_LONG)


def limit_google(request: Request, db: Session = Depends(get_db)) -> None:
    """FastAPI dependency for POST /api/auth/google (R4)."""
    _admit(db, request, GOOGLE, GOOGLE_ATTEMPTS_PER_ADDRESS, WINDOW_SHORT)
