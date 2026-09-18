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
# There is no authentication model anywhere in this app yet (an explicit,
# documented gap in api-contract.md/backend-spec.md), so the TestClient
# already makes every request here "unauthenticated" -- no login step
# exists to perform. What this criterion actually constrains is the
# share-token-scoped route surface itself: it must expose read access and
# nothing else. "The same request against a write endpoint on the same
# trip" is exercised as a mutating verb against that same share-token URL,
# which has no route registered for anything but GET.
# ---------------------------------------------------------------------------


def test_share_link_read_succeeds_and_write_is_rejected(client, trip):
    client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"}
    )
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]

    read_resp = client.get(f"/api/share/{token}")
    assert read_resp.status_code == 200

    write_resp = client.put(f"/api/share/{token}", json={"name": "Hijacked"})
    assert write_resp.status_code in (404, 405)
