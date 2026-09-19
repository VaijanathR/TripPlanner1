import datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    # Null for accounts that only ever signed in with Google.
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    google_sub: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    trips: Mapped[list["Trip"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    share_token: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    # Where the trip is going. All null until the user picks a destination.
    geoname_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    state: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    country_code: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def destination(self) -> dict | None:
        if self.geoname_id is None:
            return None
        return {
            "geoname_id": self.geoname_id,
            "city": self.city,
            "state": self.state,
            "country": self.country,
            "country_code": self.country_code,
            "latitude": self.latitude,
            "longitude": self.longitude,
        }

    owner: Mapped["User"] = relationship(back_populates="trips")
    days: Mapped[list["Day"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Day.order_index"
    )


class Day(Base):
    __tablename__ = "days"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    location: Mapped[str] = mapped_column(String, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped["Trip"] = relationship(back_populates="days")
    activities: Mapped[list["Activity"]] = relationship(
        back_populates="day",
        cascade="all, delete-orphan",
        order_by="Activity.order_index",
    )


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day_id: Mapped[int] = mapped_column(
        ForeignKey("days.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    start_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    end_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    day: Mapped["Day"] = relationship(back_populates="activities")


class DestinationGuide(Base):
    """Cached guide (photos, popular places, things to do) for one place,
    shared by every trip going there. See guide.py."""

    __tablename__ = "destination_guides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    geoname_id: Mapped[int] = mapped_column(Integer, unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="building")
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthAttempt(Base):
    """One recorded sign-in attempt, for rate limiting (see ratelimit.py). Holds
    only SHA-256 hashes of the email and the caller address, never the raw values."""

    __tablename__ = "auth_attempts"
    __table_args__ = (
        Index("ix_auth_attempts_kind_address_created", "kind", "address_hash", "created_at"),
        Index("ix_auth_attempts_kind_email_address", "kind", "email_hash", "address_hash"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # login_failure | signup | google
    email_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    address_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)

