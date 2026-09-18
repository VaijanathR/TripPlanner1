from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from deps import get_day_or_404, get_trip_or_404
from errors import validation_error

router = APIRouter(prefix="/api/trips/{trip_id}/days", tags=["days"])


@router.post("", response_model=schemas.DayOut, status_code=201)
def create_day(trip_id: int, payload: schemas.DayCreate, db: Session = Depends(get_db)):
    get_trip_or_404(db, trip_id)
    next_order = db.query(models.Day).filter(models.Day.trip_id == trip_id).count()
    day = models.Day(
        trip_id=trip_id,
        date=payload.date,
        location=payload.location,
        notes=payload.notes,
        order_index=next_order,
    )
    db.add(day)
    db.commit()
    db.refresh(day)
    return day


def _validate_activities(activities: list[schemas.ActivityIn]) -> None:
    fields: dict[str, str] = {}
    for index, activity in enumerate(activities):
        if activity.end_time < activity.start_time:
            fields[f"activities[{index}].end_time"] = "must not be before start_time"
    if fields:
        raise validation_error(
            "One or more activities have an end time before their start time", fields
        )


# Registered before "/{day_id}" so "reorder" is matched as a literal path
# segment, not swallowed by the int-typed day_id parameter.
@router.put("/reorder", response_model=schemas.DaysReorderResponse)
def reorder_days(trip_id: int, payload: schemas.DaysReorderRequest, db: Session = Depends(get_db)):
    get_trip_or_404(db, trip_id)
    days = db.query(models.Day).filter(models.Day.trip_id == trip_id).all()
    existing_ids = {day.id for day in days}
    incoming_ids = payload.day_ids

    if len(incoming_ids) != len(set(incoming_ids)) or set(incoming_ids) != existing_ids:
        missing = existing_ids - set(incoming_ids)
        unexpected = set(incoming_ids) - existing_ids
        parts = []
        if missing:
            parts.append(f"missing day(s) {sorted(missing)}")
        if unexpected:
            parts.append(f"unexpected day(s) {sorted(unexpected)}")
        if len(incoming_ids) != len(set(incoming_ids)):
            parts.append("duplicate day ids")
        raise validation_error(
            "day_ids must match the trip's current days exactly",
            {"day_ids": "; ".join(parts)},
        )

    by_id = {day.id: day for day in days}
    for index, day_id in enumerate(incoming_ids):
        by_id[day_id].order_index = index
    db.commit()

    days = (
        db.query(models.Day)
        .filter(models.Day.trip_id == trip_id)
        .order_by(models.Day.order_index)
        .all()
    )
    return schemas.DaysReorderResponse(days=days)


@router.put("/{day_id}", response_model=schemas.DayOut)
def update_day(
    trip_id: int, day_id: int, payload: schemas.DayUpdate, db: Session = Depends(get_db)
):
    get_trip_or_404(db, trip_id)
    day = get_day_or_404(db, trip_id, day_id)

    _validate_activities(payload.activities)

    day.date = payload.date
    day.location = payload.location
    day.notes = payload.notes

    incoming_ids = {a.id for a in payload.activities if a.id is not None}
    existing_by_id = {a.id: a for a in day.activities}

    for existing_id, activity in list(existing_by_id.items()):
        if existing_id not in incoming_ids:
            db.delete(activity)

    for activity_in in payload.activities:
        if activity_in.id is not None and activity_in.id in existing_by_id:
            activity = existing_by_id[activity_in.id]
            activity.title = activity_in.title
            activity.start_time = activity_in.start_time
            activity.end_time = activity_in.end_time
            activity.notes = activity_in.notes
            activity.order_index = activity_in.order_index
        else:
            db.add(
                models.Activity(
                    day_id=day.id,
                    title=activity_in.title,
                    start_time=activity_in.start_time,
                    end_time=activity_in.end_time,
                    notes=activity_in.notes,
                    order_index=activity_in.order_index,
                )
            )

    db.commit()
    db.refresh(day)
    return day


@router.delete("/{day_id}", status_code=204)
def delete_day(trip_id: int, day_id: int, db: Session = Depends(get_db)):
    get_trip_or_404(db, trip_id)
    day = get_day_or_404(db, trip_id, day_id)
    db.delete(day)
    db.commit()
