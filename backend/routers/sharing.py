import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from auth import current_user
from database import get_db
from deps import get_trip_or_404
from errors import not_found
from routers.conditions import build_conditions_response

trip_share_router = APIRouter(
    prefix="/api/trips/{trip_id}/share", tags=["sharing"], dependencies=[Depends(current_user)]
)
public_share_router = APIRouter(prefix="/api/share/{share_token}", tags=["sharing"])


@trip_share_router.post("", response_model=schemas.ShareTokenResponse)
def create_share_link(
    trip_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)
):
    trip = get_trip_or_404(db, trip_id, user)
    if trip.share_token is None:
        trip.share_token = str(uuid.uuid4())
        db.commit()
        db.refresh(trip)
    return schemas.ShareTokenResponse(share_token=trip.share_token)


def _get_trip_by_share_token_or_404(db: Session, share_token: str) -> models.Trip:
    trip = db.query(models.Trip).filter(models.Trip.share_token == share_token).first()
    if trip is None:
        # Deliberately identical whether the token never existed, was
        # never generated, or its trip was deleted -- never leak which.
        raise not_found("This itinerary is unavailable")
    return trip


@public_share_router.get("", response_model=schemas.SharedTripDetail)
def read_shared_trip(share_token: str, db: Session = Depends(get_db)):
    return _get_trip_by_share_token_or_404(db, share_token)


@public_share_router.get("/days/{day_id}/conditions")
def read_shared_day_conditions(share_token: str, day_id: int, db: Session = Depends(get_db)):
    trip = _get_trip_by_share_token_or_404(db, share_token)
    day = next((d for d in trip.days if d.id == day_id), None)
    if day is None:
        raise not_found("This itinerary is unavailable")
    return build_conditions_response(day)
