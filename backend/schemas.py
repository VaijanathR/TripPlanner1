from __future__ import annotations

import datetime

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ActivityIn(BaseModel):
    id: int | None = None
    title: str
    start_time: datetime.time
    end_time: datetime.time
    notes: str | None = None
    order_index: int

    @field_validator("title")
    @classmethod
    def title_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    day_id: int
    title: str
    start_time: datetime.time
    end_time: datetime.time
    notes: str | None
    order_index: int


class DayCreate(BaseModel):
    date: datetime.date
    location: str
    notes: str | None = None

    @field_validator("location")
    @classmethod
    def location_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v


class DayUpdate(BaseModel):
    date: datetime.date
    location: str
    notes: str | None = None
    activities: list[ActivityIn] = Field(default_factory=list)

    @field_validator("location")
    @classmethod
    def location_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v


class DayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    date: datetime.date
    location: str
    notes: str | None
    order_index: int
    activities: list[ActivityOut]


class DaySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    date: datetime.date
    location: str
    notes: str | None
    order_index: int


class DaysReorderRequest(BaseModel):
    day_ids: list[int]


class DaysReorderResponse(BaseModel):
    days: list[DaySummary]


class TripCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v


class DestinationOut(BaseModel):
    geoname_id: int
    city: str | None
    state: str | None
    country: str | None
    country_code: str | None
    latitude: float | None
    longitude: float | None


class DestinationSet(BaseModel):
    geoname_id: int = Field(gt=0)


class TripSummary(BaseModel):
    id: int
    name: str
    start_date: datetime.date | None
    end_date: datetime.date | None
    day_count: int
    destination: DestinationOut | None = None
    cover_image_url: str | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class TripsListResponse(BaseModel):
    trips: list[TripSummary]


class TripDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    share_token: str | None
    destination: DestinationOut | None = None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    days: list[DayOut]


class ShareTokenResponse(BaseModel):
    share_token: str


class SharedTripDetail(BaseModel):
    """Same as TripDetail but never re-exposes the share_token itself."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    destination: DestinationOut | None = None
    days: list[DayOut]


# -- auth --------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128


def _clean_email(v: str) -> str:
    v = v.strip().lower()
    if len(v) > 254 or not _EMAIL_RE.match(v):
        raise ValueError("must be a valid email address")
    return v


class RegisterRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_must_be_valid(cls, v: str) -> str:
        return _clean_email(v)

    @field_validator("password")
    @classmethod
    def password_must_be_long_enough(cls, v: str) -> str:
        if not MIN_PASSWORD_LENGTH <= len(v) <= MAX_PASSWORD_LENGTH:
            raise ValueError(
                f"must be between {MIN_PASSWORD_LENGTH} and {MAX_PASSWORD_LENGTH} characters"
            )
        return v


class LoginRequest(BaseModel):
    email: str
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v: str) -> str:
        return v.strip().lower()


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=1)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# -- destination guide ----------------------------------------------------------


class PlaceCandidate(BaseModel):
    geoname_id: int
    city: str
    state: str | None
    country: str
    country_code: str
    latitude: float
    longitude: float
    population: int | None = None


class PlaceCandidates(BaseModel):
    candidates: list[PlaceCandidate]


class GuidePhoto(BaseModel):
    title: str | None = None
    description: str | None = None
    extract: str | None = None
    image_url: str | None = None
    credit_url: str | None = None
    page_url: str | None = None


class GuidePhotos(BaseModel):
    city: GuidePhoto | None = None
    state: GuidePhoto | None = None
    country: GuidePhoto | None = None


class GalleryImage(BaseModel):
    title: str
    image_url: str
    credit_url: str | None = None


class GuidePlace(BaseModel):
    id: str
    name: str
    description: str | None = None
    type: str | None = None
    theme: str
    sitelinks: int
    distance_km: float | None = None
    latitude: float | None = None
    longitude: float | None = None
    image_url: str | None = None
    credit_url: str | None = None
    wikidata_url: str | None = None


class GuidePlaces(BaseModel):
    city: list[GuidePlace] = []
    around: list[GuidePlace] = []


class GuideActivity(BaseModel):
    theme: str
    label: str
    summary: str
    places: list[str]


class GuideOut(BaseModel):
    # "no_destination" | "building" | "ready" | "failed"
    status: str
    destination: DestinationOut | None = None
    photos: GuidePhotos = GuidePhotos()
    gallery: list[GalleryImage] = []
    places: GuidePlaces = GuidePlaces()
    activities: list[GuideActivity] = []
    # per source: "pending" | "ready" | "unavailable"
    sections: dict[str, str] = {}
