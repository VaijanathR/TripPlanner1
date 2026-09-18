from __future__ import annotations

import datetime

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


class TripSummary(BaseModel):
    id: int
    name: str
    start_date: datetime.date | None
    end_date: datetime.date | None
    day_count: int
    created_at: datetime.datetime
    updated_at: datetime.datetime


class TripsListResponse(BaseModel):
    trips: list[TripSummary]


class TripDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    share_token: str | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    days: list[DayOut]
