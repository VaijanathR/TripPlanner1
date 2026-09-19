from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from auth import current_user
from database import get_db
from deps import get_trip_or_404

router = APIRouter(prefix="/api/trips", tags=["trips"], dependencies=[Depends(current_user)])


def _trip_summary(trip: models.Trip) -> schemas.TripSummary:
    dates = [day.date for day in trip.days]
    return schemas.TripSummary(
        id=trip.id,
        name=trip.name,
        start_date=min(dates) if dates else None,
        end_date=max(dates) if dates else None,
        day_count=len(trip.days),
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )


@router.get("", response_model=schemas.TripsListResponse)
def list_trips(db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    trips = (
        db.query(models.Trip)
        .filter(models.Trip.user_id == user.id)
        .order_by(models.Trip.created_at)
        .all()
    )
    return schemas.TripsListResponse(trips=[_trip_summary(t) for t in trips])


@router.post("", response_model=schemas.TripDetail, status_code=201)
def create_trip(
    payload: schemas.TripCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    trip = models.Trip(name=payload.name, user_id=user.id)
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip


@router.get("/{trip_id}", response_model=schemas.TripDetail)
def get_trip(trip_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return get_trip_or_404(db, trip_id, user)


@router.delete("/{trip_id}", status_code=204)
def delete_trip(trip_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    trip = get_trip_or_404(db, trip_id, user)
    db.delete(trip)
    db.commit()
