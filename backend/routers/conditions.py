from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
from database import get_db
from deps import get_day_or_404
from weather import get_conditions

router = APIRouter(prefix="/api/trips/{trip_id}/days", tags=["conditions"])


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
def read_day_conditions(trip_id: int, day_id: int, db: Session = Depends(get_db)):
    day = get_day_or_404(db, trip_id, day_id)
    return build_conditions_response(day)
