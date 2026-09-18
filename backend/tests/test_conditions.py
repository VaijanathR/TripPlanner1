from routers import conditions


def _create_day(client, trip_id, date="2026-11-03", location="Kyoto, Japan"):
    resp = client.post(f"/api/trips/{trip_id}/days", json={"date": date, "location": location})
    assert resp.status_code == 201
    return resp.json()


def test_conditions_ok_shape(client, trip):
    day = _create_day(client, trip["id"])
    resp = client.get(f"/api/trips/{trip['id']}/days/{day['id']}/conditions")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert set(body["data"].keys()) == {"temperature_c", "condition", "map_url"}
    assert "checked_at" in body


def test_conditions_unavailable_shape_is_200_not_5xx(client, trip, monkeypatch):
    day = _create_day(client, trip["id"])
    monkeypatch.setattr(conditions, "get_conditions", lambda location: {"status": "unavailable"})

    resp = client.get(f"/api/trips/{trip['id']}/days/{day['id']}/conditions")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "unavailable"
    assert "data" not in body
    assert "checked_at" in body


def test_conditions_day_not_found(client, trip):
    resp = client.get(f"/api/trips/{trip['id']}/days/999/conditions")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["message"] == "Day not found"


def test_conditions_trip_not_found_also_reports_day_not_found(client):
    # Per api-contract.md: trip-missing and day-missing both resolve to
    # the same "Day not found" message -- callers shouldn't be able to
    # distinguish which one was missing from this endpoint.
    resp = client.get("/api/trips/999/days/999/conditions")
    assert resp.status_code == 404
    assert resp.json()["error"]["message"] == "Day not found"
