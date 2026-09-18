from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from deps import get_day_or_404
from weather import get_conditions

router = APIRouter(prefix="/api/trips/{trip_id}/days", tags=["conditions"])


@router.get("/{day_id}/conditions")
def read_day_conditions(trip_id: int, day_id: int, db: Session = Depends(get_db)):
    day = get_day_or_404(db, trip_id, day_id)

    result = get_conditions(day.location)
    result["checked_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return result
