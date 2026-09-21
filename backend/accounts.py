"""Deleting an account: the one place it happens, for both the owner and an admin."""

import datetime
import logging

from sqlalchemy.orm import Session

import models

log = logging.getLogger("trip_planner.accounts")


def delete_account(db: Session, user: models.User, *, actor: models.User) -> None:
    """Delete `user` and everything they own (trips, days, activities; the ORM
    cascades), then log who did it. The destination-guide cache is shared between
    users and the hashed sign-in attempt records are not account data: both stay."""
    # Read everything needed for the log first: for a self-deletion `actor` is the
    # very object being deleted.
    actor_id, actor_email = actor.id, actor.email
    deleted_id, deleted_email = user.id, user.email
    db.delete(user)
    db.commit()
    log.info(
        "account deleted: actor_id=%s actor=%s deleted_id=%s deleted=%s at=%s",
        actor_id, actor_email, deleted_id, deleted_email, datetime.datetime.now(datetime.UTC).isoformat(),
    )
