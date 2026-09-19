from dataclasses import asdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import geocoding
import guide
import models
import schemas
import upstream
from auth import current_user
from database import get_db
from deps import get_trip_or_404
from errors import AppError

router = APIRouter(prefix="/api", tags=["destinations"], dependencies=[Depends(current_user)])


@router.get("/destinations/search", response_model=schemas.PlaceCandidates)
def search_destinations(
    city: str = Query(min_length=2, max_length=100),
    state: str | None = Query(default=None, max_length=100),
    country: str | None = Query(default=None, max_length=100),
):
    """Places matching what the user typed, for them to pick from ("Paris" is
    France and Texas)."""
    try:
        places = geocoding.search_places(city, state, country)
    except upstream.UpstreamError:
        raise AppError(503, "destinations_unavailable", "Place search is temporarily unavailable") from None
    return {"candidates": [asdict(p) for p in places]}


@router.put("/trips/{trip_id}/destination", response_model=schemas.TripDetail)
def set_destination(
    trip_id: int,
    payload: schemas.DestinationSet,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    trip = get_trip_or_404(db, trip_id, user)
    try:
        place = geocoding.get_place(payload.geoname_id)
    except upstream.UpstreamError:
        raise AppError(503, "destinations_unavailable", "Place lookup is temporarily unavailable") from None
    if place is None:
        raise AppError(404, "place_not_found", "That place doesn't exist")

    # Only ids that came back from the geocoder are stored, never client-sent
    # names or coordinates.
    trip.geoname_id = place.geoname_id
    trip.city, trip.state = place.city, place.state
    trip.country, trip.country_code = place.country, place.country_code
    trip.latitude, trip.longitude = place.latitude, place.longitude
    db.commit()
    db.refresh(trip)
    guide.ensure_guide(db, trip.destination)  # start warming the guide now
    db.refresh(trip)
    return trip


@router.delete("/trips/{trip_id}/destination", response_model=schemas.TripDetail)
def clear_destination(
    trip_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)
):
    trip = get_trip_or_404(db, trip_id, user)
    trip.geoname_id = trip.city = trip.state = trip.country = trip.country_code = None
    trip.latitude = trip.longitude = None
    db.commit()
    db.refresh(trip)
    return trip


@router.get("/trips/{trip_id}/guide", response_model=schemas.GuideOut)
def get_guide(trip_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Photos, popular places and things to do for the trip's destination. While
    a guide is still being built, returns what is ready so far (poll again)."""
    trip = get_trip_or_404(db, trip_id, user)
    destination = trip.destination
    if destination is None:
        return {"status": "no_destination"}
    row = guide.ensure_guide(db, destination)
    return guide.guide_response(row, destination)
