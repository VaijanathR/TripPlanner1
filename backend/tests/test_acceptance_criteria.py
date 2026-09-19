"""Tests written directly against the Step 10 acceptance-criteria table.

Each test below is annotated with the criterion it proves and the test
type the table specifies. See backend/tests/test_days.py and
test_conditions.py for the broader, feature-level test coverage these
complement.
"""

import datetime
import time

import pytest

import weather
from errors import AppError
from routers.days import _validate_activities
from schemas import ActivityIn


# ---------------------------------------------------------------------------
# Criterion: "A Day cannot be saved with an end time before its start time"
# Test type: Unit -- call the validation function directly with a bad time
# pair and assert it raises the expected error.
# ---------------------------------------------------------------------------


def test_validate_activities_raises_when_end_time_before_start_time():
    activities = [
        ActivityIn(
            id=None,
            title="Bad activity",
            start_time=datetime.time(12, 0),
            end_time=datetime.time(9, 0),
            order_index=0,
        )
    ]

    with pytest.raises(AppError) as exc_info:
        _validate_activities(activities)

    err = exc_info.value
    assert err.status_code == 422
    assert err.code == "validation_error"
    assert "activities[0].end_time" in err.fields


def test_validate_activities_does_not_raise_when_end_time_after_start_time():
    activities = [
        ActivityIn(
            id=None,
            title="Good activity",
            start_time=datetime.time(9, 0),
            end_time=datetime.time(12, 0),
            order_index=0,
        )
    ]

    _validate_activities(activities)  # should not raise


# Test type (endpoint-level companion): the unit tests above only prove the
# validator works in isolation. This proves it is actually wired into the
# save path -- an invalid day is rejected with 422 and nothing is persisted.
def test_saving_a_day_with_end_before_start_is_rejected_by_the_endpoint(client, trip):
    day = client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"}
    ).json()

    resp = client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={
            "date": "2026-11-03",
            "location": "Kyoto, Japan",
            "activities": [
                {"id": None, "title": "Bad", "start_time": "12:00", "end_time": "09:00", "order_index": 0}
            ],
        },
    )

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"
    assert "activities[0].end_time" in resp.json()["error"]["fields"]

    saved_day = client.get(f"/api/trips/{trip['id']}").json()["days"][0]
    assert saved_day["activities"] == []


# ---------------------------------------------------------------------------
# Criterion: "The itinerary still renders with an 'unavailable' state when
# the maps/weather call times out"
# Test type: Integration -- the API wrapper is exercised through the real
# HTTP endpoint against a mocked upstream provider configured to time out;
# the endpoint must still return 200 with status: "unavailable".
# ---------------------------------------------------------------------------


class HangingUpstreamProvider:
    """Stands in for a real maps/weather provider that never responds."""

    def fetch(self, location):
        time.sleep(weather.TIMEOUT_SECONDS + 0.3)
        return weather.ConditionsData(temperature_c=0, condition="unreachable", map_url="")


def test_conditions_endpoint_returns_200_unavailable_when_upstream_times_out(
    client, trip, monkeypatch
):
    monkeypatch.setattr(weather, "TIMEOUT_SECONDS", 0.2)
    monkeypatch.setattr(weather, "_default_provider", lambda: HangingUpstreamProvider())

    day_resp = client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"}
    )
    day = day_resp.json()

    resp = client.get(f"/api/trips/{trip['id']}/days/{day['id']}/conditions")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "unavailable"
    assert "data" not in body
    assert "checked_at" in body


# ---------------------------------------------------------------------------
# Criterion: "Share links are read-only and require no login"
# Test type: Integration -- an unauthenticated request to a share-view
# endpoint succeeds; the same request against a write endpoint on the same
# trip is rejected.
#
# Two halves, both with a client that carries NO credentials (anon_client):
#   1. the share-token URL serves a read and offers no way to write;
#   2. the trip's own write endpoint -- the "write endpoint on the same trip"
#      -- rejects that same unauthenticated caller with 401 and changes
#      nothing. (Added when accounts were introduced; before that the app had
#      no authentication and this half could only be argued, not tested.)
# The full sweep of every route lives in test_access_control.py.
# ---------------------------------------------------------------------------


def test_share_link_read_succeeds_and_write_is_rejected(client, anon_client):
    trip = client.post("/api/trips", json={"name": "Kyoto in Autumn"}).json()
    client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"}
    )
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]

    read_resp = anon_client.get(f"/api/share/{token}")
    assert read_resp.status_code == 200

    write_resp = anon_client.put(f"/api/share/{token}", json={"name": "Hijacked"})
    assert write_resp.status_code in (404, 405)


def test_the_same_trips_own_write_endpoint_rejects_an_unauthenticated_caller(client, anon_client):
    trip = client.post("/api/trips", json={"name": "Kyoto in Autumn"}).json()
    day = client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"}
    ).json()
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]
    assert anon_client.get(f"/api/share/{token}").status_code == 200  # the read half still works

    resp = anon_client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={"date": "2026-11-04", "location": "Hijacked", "activities": []},
    )

    assert resp.status_code == 401
    still = client.get(f"/api/trips/{trip['id']}").json()["days"][0]
    assert (still["location"], still["date"]) == ("Kyoto, Japan", "2026-11-03")
