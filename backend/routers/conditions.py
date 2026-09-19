from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
from auth import current_user
from database import get_db
from deps import get_day_or_404
from errors import not_found
from weather import get_conditions

router = APIRouter(
    prefix="/api/trips/{trip_id}/days", tags=["conditions"], dependencies=[Depends(current_user)]
)


def build_conditions_response(day: models.Day) -> dict:
    """Shared by the trip-scoped and share-token-scoped conditions routes.

    Kept here so weather.py itself is still only ever imported by this
    one module -- routers/sharing.py calls this function instead of
    importing weather directly.
    """
    result = get_conditions(day.location)
    result["checked_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return result


@router.get("/{day_id}/conditions")
def read_day_conditions(
    trip_id: int,
    day_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    day = get_day_or_404(db, trip_id, day_id)
    # Per api-contract.md this endpoint never says *which* of trip/day was
    # missing, so someone else's day gets the same "Day not found".
    if day.trip.user_id != user.id:
        raise not_found("Day not found")
    return build_conditions_response(day)
