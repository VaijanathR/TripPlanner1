def test_create_trip(client):
    resp = client.post("/api/trips", json={"name": "Kyoto in Autumn"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Kyoto in Autumn"
    assert body["share_token"] is None
    assert body["days"] == []


def test_create_trip_empty_name_is_422(client):
    resp = client.post("/api/trips", json={"name": "   "})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "validation_error"
    assert "name" in body["error"]["fields"]


def test_list_trips_empty(client):
    resp = client.get("/api/trips")
    assert resp.status_code == 200
    assert resp.json() == {"trips": []}


def test_list_trips_summary_shape(client, trip):
    client.post(f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"})
    client.post(f"/api/trips/{trip['id']}/days", json={"date": "2026-11-05", "location": "Osaka, Japan"})

    resp = client.get("/api/trips")
    assert resp.status_code == 200
    summary = resp.json()["trips"][0]
    assert summary["day_count"] == 2
    assert summary["start_date"] == "2026-11-03"
    assert summary["end_date"] == "2026-11-05"


def test_get_trip(client, trip):
    resp = client.get(f"/api/trips/{trip['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == trip["id"]


def test_get_trip_not_found(client):
    resp = client.get("/api/trips/999")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


def test_delete_trip(client, trip):
    resp = client.delete(f"/api/trips/{trip['id']}")
    assert resp.status_code == 204

    resp = client.get(f"/api/trips/{trip['id']}")
    assert resp.status_code == 404


def test_delete_trip_not_found(client):
    resp = client.delete("/api/trips/999")
    assert resp.status_code == 404


def test_delete_trip_cascades_to_days_and_activities(client, trip, db_session_factory):
    import models

    day_resp = client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"}
    )
    day = day_resp.json()
    activity_resp = client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={
            "date": "2026-11-03",
            "location": "Kyoto, Japan",
            "activities": [
                {"id": None, "title": "Hike", "start_time": "08:00", "end_time": "11:00", "order_index": 0}
            ],
        },
    )
    activity_id = activity_resp.json()["activities"][0]["id"]

    resp = client.delete(f"/api/trips/{trip['id']}")
    assert resp.status_code == 204

    db = db_session_factory()
    try:
        assert db.get(models.Day, day["id"]) is None
        assert db.get(models.Activity, activity_id) is None
    finally:
        db.close()
