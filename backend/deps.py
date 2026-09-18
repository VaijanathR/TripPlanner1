from sqlalchemy.orm import Session

import models
from errors import not_found


def get_trip_or_404(db: Session, trip_id: int) -> models.Trip:
    trip = db.get(models.Trip, trip_id)
    if trip is None:
        raise not_found("Trip not found")
    return trip


def get_day_or_404(db: Session, trip_id: int, day_id: int) -> models.Day:
    day = db.get(models.Day, day_id)
    if day is None or day.trip_id != trip_id:
        raise not_found("Day not found")
    return day
