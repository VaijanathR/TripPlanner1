"""Every trip endpoint needs a login, and a user only ever reaches their own trips."""

import re

import pytest
from main import app

# The ONLY /api routes reachable without a login. Anything else that shows up
# here unauthenticated is a hole -- adding a route means deciding, on purpose,
# whether it belongs on this list.
PUBLIC_ROUTES = {
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/google"),
    ("GET", "/api/share/{share_token}"),
    ("GET", "/api/share/{share_token}/days/{day_id}/conditions"),
}


def _api_routes():
    """Every (METHOD, path) the app serves under /api, read from the OpenAPI
    schema. (Walking app.routes misses routers added with include_router in
    current FastAPI, which would make the sweeps below silently test nothing.)"""
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/api"):
            for method in operations:
                if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                    yield method.upper(), path


def test_route_enumeration_actually_finds_the_api():
    routes = set(_api_routes())

    assert ("GET", "/api/trips") in routes and ("DELETE", "/api/trips/{trip_id}") in routes
    assert len(routes) >= 15, f"only found {len(routes)} routes -- enumeration is broken"


def test_the_public_allowlist_has_no_stale_entries():
    assert PUBLIC_ROUTES <= set(_api_routes())


@pytest.mark.parametrize("method,path", sorted(set(_api_routes()) - PUBLIC_ROUTES))
def test_every_non_public_route_rejects_a_request_with_no_login(anon_client, method, path):
    url = re.sub(r"\{[^}]+\}", "1", path)

    # Empty body on purpose: authentication must be checked before validation.
    resp = anon_client.request(method, url, json={} if method in {"POST", "PUT", "PATCH"} else None)

    assert resp.status_code == 401, f"{method} {path} answered {resp.status_code} without a login"
    assert resp.json()["error"]["code"] == "unauthenticated"


@pytest.mark.parametrize("method,path", sorted(set(_api_routes()) - PUBLIC_ROUTES))
def test_every_non_public_route_rejects_a_bad_token(anon_client, method, path):
    url = re.sub(r"\{[^}]+\}", "1", path)

    resp = anon_client.request(method, url, headers={"Authorization": "Bearer not.a.token"})

    assert resp.status_code == 401


# ------------------------------------------------------------- unauthenticated


def test_an_unauthenticated_write_to_a_trips_own_endpoint_is_rejected_and_changes_nothing(
    client, anon_client
):
    """Step 10 row 3: the same trip's *own* write endpoint rejects a caller with no login."""
    trip = client.post("/api/trips", json={"name": "Kyoto"}).json()
    day = client.post(f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto"}).json()
    update = {"date": "2026-11-04", "location": "Hijacked", "activities": []}

    resp = anon_client.put(f"/api/trips/{trip['id']}/days/{day['id']}", json=update)

    assert resp.status_code == 401
    unchanged = client.get(f"/api/trips/{trip['id']}").json()["days"][0]
    assert (unchanged["location"], unchanged["date"]) == ("Kyoto", "2026-11-03")


def test_share_links_still_work_with_no_login(client, anon_client):
    trip = client.post("/api/trips", json={"name": "Kyoto"}).json()
    day = client.post(f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto"}).json()
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]

    assert anon_client.get(f"/api/share/{token}").status_code == 200
    assert anon_client.get(f"/api/share/{token}/days/{day['id']}/conditions").status_code == 200


# ------------------------------------------------------------------- isolation


@pytest.fixture()
def owners_trip(client):
    trip = client.post("/api/trips", json={"name": "Owner's trip"}).json()
    day = client.post(f"/api/trips/{trip['id']}/days", json={"date": "2026-11-03", "location": "Kyoto"}).json()
    return trip, day


def test_a_new_trip_belongs_to_whoever_created_it(client, other_client):
    mine = client.post("/api/trips", json={"name": "Mine"}).json()
    theirs = other_client.post("/api/trips", json={"name": "Theirs"}).json()

    assert [t["name"] for t in client.get("/api/trips").json()["trips"]] == ["Mine"]
    assert [t["name"] for t in other_client.get("/api/trips").json()["trips"]] == ["Theirs"]
    assert client.get(f"/api/trips/{mine['id']}").status_code == 200
    assert other_client.get(f"/api/trips/{theirs['id']}").status_code == 200


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/api/trips/{t}", None),
        ("DELETE", "/api/trips/{t}", None),
        ("POST", "/api/trips/{t}/days", {"date": "2026-11-05", "location": "X"}),
        ("PUT", "/api/trips/{t}/days/reorder", {"day_ids": [0]}),
        ("PUT", "/api/trips/{t}/days/{d}", {"date": "2026-11-05", "location": "Hijacked", "activities": []}),
        ("DELETE", "/api/trips/{t}/days/{d}", None),
        ("GET", "/api/trips/{t}/days/{d}/conditions", None),
        ("POST", "/api/trips/{t}/share", None),
    ],
)
def test_another_users_trip_is_indistinguishable_from_a_missing_one(
    other_client, owners_trip, method, path, body
):
    trip, day = owners_trip
    url = path.format(t=trip["id"], d=day["id"])
    missing = path.format(t=999999, d=999999)

    real = other_client.request(method, url, json=body)
    absent = other_client.request(method, missing, json=body)

    assert real.status_code == 404
    assert real.json() == absent.json()  # same message: no way to tell "exists" from "not yours"


def test_a_rejected_attempt_on_someone_elses_trip_changes_nothing(client, other_client, owners_trip):
    trip, day = owners_trip

    other_client.put(
        f"/api/trips/{trip['id']}/days/{day['id']}",
        json={"date": "2026-11-05", "location": "Hijacked", "activities": []},
    )
    other_client.delete(f"/api/trips/{trip['id']}/days/{day['id']}")
    other_client.delete(f"/api/trips/{trip['id']}")

    intact = client.get(f"/api/trips/{trip['id']}").json()
    assert intact["name"] == "Owner's trip"
    assert [d["location"] for d in intact["days"]] == ["Kyoto"]


def test_a_user_cannot_use_their_own_trip_id_to_reach_another_users_day(client, other_client, owners_trip):
    _, owners_day = owners_trip
    mine = other_client.post("/api/trips", json={"name": "Mine"}).json()

    resp = other_client.put(
        f"/api/trips/{mine['id']}/days/{owners_day['id']}",
        json={"date": "2026-11-05", "location": "Hijacked", "activities": []},
    )

    assert resp.status_code == 404


def test_a_share_link_is_readable_by_anyone_but_creating_one_is_owner_only(client, other_client, anon_client):
    trip = client.post("/api/trips", json={"name": "Kyoto"}).json()
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]

    assert anon_client.get(f"/api/share/{token}").status_code == 200
    assert other_client.get(f"/api/share/{token}").status_code == 200
    assert other_client.post(f"/api/trips/{trip['id']}/share").status_code == 404
