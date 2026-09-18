def test_create_share_link(client, trip):
    resp = client.post(f"/api/trips/{trip['id']}/share")
    assert resp.status_code == 200
    body = resp.json()
    assert body["share_token"]


def test_create_share_link_is_idempotent(client, trip):
    first = client.post(f"/api/trips/{trip['id']}/share").json()
    second = client.post(f"/api/trips/{trip['id']}/share").json()
    assert first["share_token"] == second["share_token"]


def test_create_share_link_trip_not_found(client):
    resp = client.post("/api/trips/999/share")
    assert resp.status_code == 404


def test_read_shared_trip(client, trip):
    client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"}
    )
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]

    resp = client.get(f"/api/share/{token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == trip["name"]
    assert "share_token" not in body
    assert len(body["days"]) == 1


def test_read_shared_trip_invalid_token(client):
    resp = client.get("/api/share/not-a-real-token")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["message"] == "This itinerary is unavailable"


def test_deleting_trip_invalidates_share_link(client, trip):
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]
    client.delete(f"/api/trips/{trip['id']}")

    resp = client.get(f"/api/share/{token}")
    assert resp.status_code == 404
    assert resp.json()["error"]["message"] == "This itinerary is unavailable"


def test_shared_day_conditions(client, trip):
    day = client.post(
        f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto, Japan"}
    ).json()
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]

    resp = client.get(f"/api/share/{token}/days/{day['id']}/conditions")
    assert resp.status_code == 200
    assert resp.json()["status"] in ("ok", "unavailable")


def test_shared_day_conditions_wrong_day_for_token(client, trip):
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]
    resp = client.get(f"/api/share/{token}/days/999/conditions")
    assert resp.status_code == 404


def test_no_mutating_verb_reachable_under_public_share_routes(client, trip):
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]

    for method in ("post", "put", "delete", "patch"):
        resp = getattr(client, method)(f"/api/share/{token}")
        assert resp.status_code in (404, 405), f"{method.upper()} /api/share/{{token}} should be rejected"
