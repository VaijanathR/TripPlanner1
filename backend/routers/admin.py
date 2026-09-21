"""Administrator endpoints: list accounts, delete an account.
Who is an administrator: see auth.admin_emails (the ADMIN_EMAILS setting)."""

import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

import accounts
import auth
import models
import schemas
from database import get_db
from errors import AppError

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_admin)])


def _utc(moment: datetime.datetime) -> datetime.datetime:
    return moment.replace(tzinfo=datetime.UTC) if moment.tzinfo is None else moment


@router.get("/users", response_model=schemas.AdminUserList)
def list_users(db: Session = Depends(get_db)):
    rows = (
        db.query(models.User, func.count(models.Trip.id))
        .outerjoin(models.Trip, models.Trip.user_id == models.User.id)
        .group_by(models.User.id)
        .order_by(models.User.created_at, models.User.id)
        .all()
    )
    return schemas.AdminUserList(
        users=[
            schemas.AdminUserOut(
                id=user.id, email=user.email, created_at=_utc(user.created_at), trip_count=trips, is_admin=auth.is_admin(user)
            )
            for user, trips in rows
        ]
    )


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), admin: models.User = Depends(auth.require_admin)):
    user = db.get(models.User, user_id)
    if user is None:
        raise AppError(404, "user_not_found", "No such account")
    if auth.is_admin(user):  # includes the caller's own account
        raise AppError(
            409,
            "admin_account_protected",
            "Administrator accounts can't be deleted. Remove this address from the administrator list first.",
        )
    accounts.delete_account(db, user, actor=admin)
