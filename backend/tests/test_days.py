def _create_day(client, trip_id, date="2026-11-03", location="Kyoto, Japan"):
    resp = client.post(f"/api/trips/{trip_id}/days", json={"date": date, "location": location})
    assert resp.status_code == 201
    return resp.json()


def test_create_day(client, trip):
    day = _create_day(client, trip["id"])
    assert day["trip_id"] == trip["id"]
    assert day["order_index"] == 0
    assert day["activities"] == []


def test_create_day_trip_not_found(client):
    resp = client.post("/api/trips/999/days", json={"date": "2026-11-03", "location": "Kyoto"})
    assert resp.status_code == 404


def test_create_day_missing_location_is_422(client, trip):
    resp = client.post(f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "  "})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


def test_update_day_upserts_activities(client, trip):
    day = _create_day(client, trip["id"])

    resp = client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={
            "date": "2026-11-03",
            "location": "Kyoto, Japan",
            "notes": "Bring umbrella",
            "activities": [
                {"id": None, "title": "Fushimi Inari hike", "start_time": "08:00", "end_time": "11:00", "order_index": 0}
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["activities"]) == 1
    activity_id = body["activities"][0]["id"]

    # Update the existing activity and add a new one.
    resp = client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={
            "date": "2026-11-03",
            "location": "Kyoto, Japan",
            "activities": [
                {"id": activity_id, "title": "Fushimi Inari hike (early)", "start_time": "07:00", "end_time": "10:00", "order_index": 0},
                {"id": None, "title": "Lunch in Gion", "start_time": "12:00", "end_time": "13:00", "order_index": 1},
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["activities"]) == 2
    assert body["activities"][0]["title"] == "Fushimi Inari hike (early)"
    assert body["activities"][0]["id"] == activity_id


def test_update_day_removes_activities_missing_from_payload(client, trip):
    day = _create_day(client, trip["id"])
    resp = client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={
            "date": "2026-11-03",
            "location": "Kyoto, Japan",
            "activities": [
                {"id": None, "title": "Hike", "start_time": "08:00", "end_time": "11:00", "order_index": 0}
            ],
        },
    )
    assert len(resp.json()["activities"]) == 1

    resp = client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={"date": "2026-11-03", "location": "Kyoto, Japan", "activities": []},
    )
    assert resp.status_code == 200
    assert resp.json()["activities"] == []


def test_update_day_rejects_end_before_start_with_no_partial_write(client, trip):
    day = _create_day(client, trip["id"])

    # Seed one valid activity first.
    resp = client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={
            "date": "2026-11-03",
            "location": "Kyoto, Japan",
            "activities": [
                {"id": None, "title": "Hike", "start_time": "08:00", "end_time": "11:00", "order_index": 0}
            ],
        },
    )
    assert resp.status_code == 200

    # Now attempt a save where a new activity's end precedes its start.
    resp = client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={
            "date": "2026-11-03",
            "location": "Kyoto, Japan",
            "activities": [
                {"id": None, "title": "Hike", "start_time": "08:00", "end_time": "11:00", "order_index": 0},
                {"id": None, "title": "Bad activity", "start_time": "12:00", "end_time": "09:00", "order_index": 1},
            ],
        },
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "validation_error"
    assert "activities[1].end_time" in body["error"]["fields"]

    # No partial write: the day still has exactly the one original activity.
    resp = client.get(f"/api/trips/{trip['id']}")
    day_after = resp.json()["days"][0]
    assert len(day_after["activities"]) == 1
    assert day_after["activities"][0]["title"] == "Hike"


def test_update_day_not_found(client, trip):
    resp = client.put(
        f"/api/trips/{trip['id']}/days/999",
        json={"date": "2026-11-03", "location": "Kyoto, Japan", "activities": []},
    )
    assert resp.status_code == 404


def test_delete_day(client, trip):
    day = _create_day(client, trip["id"])
    resp = client.delete(f"/api/trips/{trip['id']}/days/{day['id']}")
    assert resp.status_code == 204

    resp = client.get(f"/api/trips/{trip['id']}")
    assert resp.json()["days"] == []


def test_delete_day_not_found(client, trip):
    resp = client.delete(f"/api/trips/{trip['id']}/days/999")
    assert resp.status_code == 404


def test_reorder_days(client, trip):
    day_a = _create_day(client, trip["id"], date="2026-11-03")
    day_b = _create_day(client, trip["id"], date="2026-11-04")
    day_c = _create_day(client, trip["id"], date="2026-11-05")

    resp = client.put(
        f"/api/trips/{trip['id']}/days/reorder",
        json={"day_ids": [day_c["id"], day_a["id"], day_b["id"]]},
    )
    assert resp.status_code == 200
    ordered_ids = [d["id"] for d in resp.json()["days"]]
    assert ordered_ids == [day_c["id"], day_a["id"], day_b["id"]]


def test_reorder_days_mismatched_ids_is_422(client, trip):
    day_a = _create_day(client, trip["id"])

    resp = client.put(
        f"/api/trips/{trip['id']}/days/reorder",
        json={"day_ids": [day_a["id"], 999]},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"
