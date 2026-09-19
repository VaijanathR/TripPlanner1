from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import auth
import models
import schemas
from database import get_db
from errors import AppError

router = APIRouter(prefix="/api/auth", tags=["auth"])

# One message for "no such account", "wrong password" and "this account has no
# password" -- the response must not reveal which.
_BAD_LOGIN = AppError(401, "invalid_credentials", "Incorrect email or password")


def _auth_response(user: models.User) -> schemas.AuthResponse:
    return schemas.AuthResponse(
        access_token=auth.create_access_token(user), user=schemas.UserOut.model_validate(user)
    )


@router.post("/register", response_model=schemas.AuthResponse, status_code=201)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise AppError(409, "email_taken", "An account with this email already exists")
    user = models.User(email=payload.email, password_hash=auth.hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # lost a race with a concurrent registration
        db.rollback()
        raise AppError(409, "email_taken", "An account with this email already exists") from None
    db.refresh(user)
    return _auth_response(user)


@router.post("/login", response_model=schemas.AuthResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    # verify_password does the same work whether or not the user exists.
    if not auth.verify_password(payload.password, user.password_hash if user else None):
        raise _BAD_LOGIN
    return _auth_response(user)


@router.post("/google", response_model=schemas.AuthResponse)
def google_login(payload: schemas.GoogleLoginRequest, db: Session = Depends(get_db)):
    if auth.google_client_id() is None:
        raise AppError(503, "google_unavailable", "Google sign-in is not configured")
    try:
        identity = auth.verify_google_id_token(payload.credential)
    except auth.GoogleTokenInvalid:
        raise AppError(401, "invalid_google_token", "Google sign-in could not be verified") from None
    except auth.GoogleUnavailable:
        raise AppError(503, "google_unavailable", "Google sign-in is temporarily unavailable") from None

    user = db.query(models.User).filter(models.User.google_sub == identity.sub).first()
    if user is None:
        user = db.query(models.User).filter(models.User.email == identity.email).first()
        if user is None:
            user = models.User(email=identity.email, google_sub=identity.sub)
            db.add(user)
        elif user.google_sub is not None:
            # The email belongs to an account already tied to a *different*
            # Google identity (e.g. an address that was reassigned). Never
            # re-point it.
            raise AppError(401, "invalid_google_token", "Google sign-in could not be verified")
        else:
            # An existing account with this email. Google has verified the
            # address; a password registration never was. So link the Google
            # identity and drop the password: otherwise someone who registered
            # the victim's address first would keep access after the real
            # owner signs in with Google.
            user.google_sub = identity.sub
            user.password_hash = None
    db.commit()
    db.refresh(user)
    return _auth_response(user)


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(auth.current_user)):
    return user
