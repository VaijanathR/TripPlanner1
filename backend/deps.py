from sqlalchemy.orm import Session

import models
from errors import not_found


def get_trip_or_404(db: Session, trip_id: int, user: models.User) -> models.Trip:
    """404 for a missing trip AND for someone else's trip: never reveal that a
    trip id exists to a user who doesn't own it."""
    trip = db.get(models.Trip, trip_id)
    if trip is None or trip.user_id != user.id:
        raise not_found("Trip not found")
    return trip


def get_day_or_404(db: Session, trip_id: int, day_id: int) -> models.Day:
    """Callers must have already passed the trip through get_trip_or_404."""
    day = db.get(models.Day, day_id)
    if day is None or day.trip_id != trip_id:
        raise not_found("Day not found")
    return day
