import pytest

import geocoding
import guide
import upstream
from tests.fakes import FakeUpstream, geocode_result, sparql_response, sparql_row, summary

KYOTO_RAW = geocode_result(1857910, "Kyoto", "Kyoto", "Japan", "JP", 35.02107, 135.75385, 1_463_723)
PARIS_TX = geocode_result(4717560, "Paris", "Texas", "United States", "US", 33.66094, -95.55551, 24_782)
PARIS_FR = geocode_result(2988507, "Paris", "Île-de-France Region", "France", "FR", 48.85341, 2.3488, 2_138_551)


@pytest.fixture()
def world(monkeypatch):
    """A fake internet where Kyoto and both Parises exist."""
    f = FakeUpstream()
    f.on(geocoding.SEARCH_URL, lambda url, params: {"results": [r for r in (PARIS_FR, PARIS_TX, KYOTO_RAW) if r["name"] == params["name"]]})
    f.on(geocoding.GET_URL, lambda url, params: {r["id"]: r for r in (KYOTO_RAW, PARIS_TX, PARIS_FR)}.get(int(params["id"])) or (_ for _ in ()).throw(upstream.UpstreamNotFound("x")))
    f.on(guide.WIKI_SUMMARY + "Kyoto%2C_Kyoto", summary("Kyoto", image="https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Kyoto.jpg/330px-Kyoto.jpg"))
    f.on(guide.WIKI_SUMMARY + "Kyoto_Prefecture", summary("Kyoto Prefecture", "Prefecture of Japan", lat=35.2, lon=135.4))
    f.on(guide.WIKI_SUMMARY + "Kyoto", upstream.UpstreamNotFound("x"))
    f.on(guide.WIKI_SUMMARY + "Japan", summary("Japan", "Country in East Asia"))
    f.on(guide.WIKIDATA_SPARQL, [
        sparql_response(sparql_row("Q1", "Kiyomizu-dera", 77, 2.0, "Q5393308", "Buddhist temple", image="K.jpg")),
        sparql_response(sparql_row("Q3", "Mount Hiei", 30, 20.0, "Q8502", "mountain")),
    ])
    monkeypatch.setattr(upstream, "get_json", f)
    return f


def make_trip(client, name="Kyoto trip"):
    return client.post("/api/trips", json={"name": name}).json()


# --------------------------------------------------------------------- search


def test_search_returns_candidates_for_the_user_to_pick_from(client, world):
    resp = client.get("/api/destinations/search", params={"city": "Paris"})

    assert resp.status_code == 200
    got = resp.json()["candidates"]
    assert [(c["geoname_id"], c["state"], c["country_code"]) for c in got] == [
        (2988507, "Île-de-France Region", "FR"), (4717560, "Texas", "US"),
    ]


def test_search_can_be_narrowed_by_state_and_country(client, world):
    resp = client.get("/api/destinations/search", params={"city": "Paris", "state": "Texas", "country": "United States"})

    assert [c["geoname_id"] for c in resp.json()["candidates"]] == [4717560]


def test_search_with_no_match_is_an_empty_list_not_an_error(client, world):
    resp = client.get("/api/destinations/search", params={"city": "Atlantis"})

    assert resp.status_code == 200 and resp.json() == {"candidates": []}


@pytest.mark.parametrize("params", [{}, {"city": ""}, {"city": "P"}, {"city": "x" * 101}, {"city": "Paris", "state": "y" * 101}])
def test_search_rejects_missing_or_absurd_input(client, world, params):
    assert client.get("/api/destinations/search", params=params).status_code == 422


def test_search_reports_the_service_being_down_as_503(client, monkeypatch):
    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.SEARCH_URL, upstream.UpstreamError("down")))

    resp = client.get("/api/destinations/search", params={"city": "Paris"})

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "destinations_unavailable"


# ------------------------------------------------------------------ set / clear


def test_a_trip_starts_with_no_destination(client):
    trip = make_trip(client)

    assert trip["destination"] is None


def test_choosing_a_destination_stores_the_places_real_details(client, world):
    trip = make_trip(client)

    resp = client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})

    assert resp.status_code == 200
    assert resp.json()["destination"] == {
        "geoname_id": 1857910, "city": "Kyoto", "state": "Kyoto", "country": "Japan",
        "country_code": "JP", "latitude": 35.02107, "longitude": 135.75385,
    }
    assert client.get(f"/api/trips/{trip['id']}").json()["destination"]["city"] == "Kyoto"


def test_only_the_id_is_taken_from_the_client_names_and_coordinates_come_from_the_geocoder(client, world):
    trip = make_trip(client)

    resp = client.put(
        f"/api/trips/{trip['id']}/destination",
        json={"geoname_id": 1857910, "city": "Atlantis", "latitude": 0, "longitude": 0, "country": "Nowhere"},
    )

    assert resp.json()["destination"]["city"] == "Kyoto"
    assert resp.json()["destination"]["latitude"] == 35.02107


def test_choosing_a_destination_starts_building_its_guide(client, world):
    trip = make_trip(client)

    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})

    assert world.calls_to(guide.WIKIDATA_SPARQL)  # warming started


def test_an_unknown_place_is_a_404_and_changes_nothing(client, world):
    trip = make_trip(client)

    resp = client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 99})

    assert resp.status_code == 404 and resp.json()["error"]["code"] == "place_not_found"
    assert client.get(f"/api/trips/{trip['id']}").json()["destination"] is None


@pytest.mark.parametrize("body", [{}, {"geoname_id": 0}, {"geoname_id": -5}, {"geoname_id": "abc"}])
def test_a_bad_destination_request_is_a_validation_error(client, world, body):
    trip = make_trip(client)

    assert client.put(f"/api/trips/{trip['id']}/destination", json=body).status_code == 422


def test_the_geocoder_being_down_is_a_503_and_keeps_the_old_destination(client, world):
    trip = make_trip(client)
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})
    world.on(geocoding.GET_URL, upstream.UpstreamError("down"))

    resp = client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 4717560})

    assert resp.status_code == 503
    assert client.get(f"/api/trips/{trip['id']}").json()["destination"]["city"] == "Kyoto"


def test_the_destination_can_be_changed_and_cleared(client, world):
    trip = make_trip(client)
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})

    changed = client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 4717560})
    cleared = client.delete(f"/api/trips/{trip['id']}/destination")

    assert changed.json()["destination"]["state"] == "Texas"
    assert cleared.status_code == 200 and cleared.json()["destination"] is None


def test_someone_elses_trip_cannot_be_given_a_destination_or_cleared(client, other_client, world):
    trip = make_trip(client)
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})

    put = other_client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 4717560})
    delete = other_client.delete(f"/api/trips/{trip['id']}/destination")

    assert put.status_code == delete.status_code == 404
    assert client.get(f"/api/trips/{trip['id']}").json()["destination"]["city"] == "Kyoto"


# ---------------------------------------------------------------------- guide


def test_a_trip_without_a_destination_has_no_guide(client, world):
    trip = make_trip(client)

    resp = client.get(f"/api/trips/{trip['id']}/guide")

    assert resp.status_code == 200 and resp.json()["status"] == "no_destination"


def test_the_guide_has_photos_places_and_things_to_do(client, world):
    trip = make_trip(client)
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})

    body = client.get(f"/api/trips/{trip['id']}/guide").json()

    assert body["status"] == "ready"
    assert body["destination"]["city"] == "Kyoto"
    assert body["photos"]["city"]["title"] == "Kyoto"
    assert body["photos"]["state"]["title"] == "Kyoto Prefecture"
    assert body["photos"]["country"]["title"] == "Japan"
    assert [p["name"] for p in body["places"]["city"]] == ["Kiyomizu-dera"]
    assert [p["name"] for p in body["places"]["around"]] == ["Mount Hiei"]
    assert {a["label"] for a in body["activities"]} == {"Temples, shrines & churches", "Hikes & viewpoints"}
    assert body["sections"] == {"photos": "ready", "places_city": "ready", "places_around": "ready"}


def test_the_guide_is_built_once_and_reused_by_the_next_request(client, world):
    trip = make_trip(client)
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})
    client.get(f"/api/trips/{trip['id']}/guide")
    calls = len(world.calls)

    client.get(f"/api/trips/{trip['id']}/guide")
    client.get(f"/api/trips/{trip['id']}/guide")

    assert len(world.calls) == calls


def test_two_trips_to_the_same_city_share_one_guide(client, world):
    for name in ("First", "Second"):
        t = make_trip(client, name)
        client.put(f"/api/trips/{t['id']}/destination", json={"geoname_id": 1857910})

    assert len(world.calls_to(guide.WIKIDATA_SPARQL)) == 2  # one build: city ring + wide ring


def test_a_guide_with_a_source_down_still_returns_the_rest(client, world):
    trip = make_trip(client)
    world.on(guide.WIKIDATA_SPARQL, upstream.UpstreamError("timeout"))
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})

    resp = client.get(f"/api/trips/{trip['id']}/guide")

    assert resp.status_code == 200
    body = resp.json()
    assert body["photos"]["city"]["title"] == "Kyoto"
    assert body["places"] == {"city": [], "around": []}
    assert body["sections"]["places_city"] == "unavailable"


def test_someone_elses_guide_is_a_404(client, other_client, world):
    trip = make_trip(client)
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})

    assert other_client.get(f"/api/trips/{trip['id']}/guide").status_code == 404


# ---------------------------------------------------------------- trip covers


def test_the_trip_list_shows_the_destination_and_a_cover_photo_once_the_guide_has_one(client, world):
    trip = make_trip(client)
    plain = make_trip(client, "Undecided")
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})
    client.get(f"/api/trips/{trip['id']}/guide")

    trips = {t["name"]: t for t in client.get("/api/trips").json()["trips"]}

    assert trips["Kyoto trip"]["destination"]["city"] == "Kyoto"
    assert "Kyoto.jpg" in trips["Kyoto trip"]["cover_image_url"]
    assert trips["Undecided"]["destination"] is None and trips["Undecided"]["cover_image_url"] is None


def test_a_trip_whose_guide_is_not_ready_yet_has_a_destination_but_no_cover(client, world, monkeypatch):
    monkeypatch.setattr(guide, "RUN_INLINE", False)
    monkeypatch.setattr(guide.threading, "Thread", lambda **kw: type("T", (), {"start": lambda self: None})())
    trip = make_trip(client)
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})

    summary_ = client.get("/api/trips").json()["trips"][0]

    assert summary_["destination"]["city"] == "Kyoto" and summary_["cover_image_url"] is None
    assert client.get(f"/api/trips/{trip['id']}/guide").json()["status"] == "building"


def test_a_shared_trip_shows_its_destination_but_never_the_share_token(client, anon_client, world):
    trip = make_trip(client)
    client.put(f"/api/trips/{trip['id']}/destination", json={"geoname_id": 1857910})
    token = client.post(f"/api/trips/{trip['id']}/share").json()["share_token"]

    shared = anon_client.get(f"/api/share/{token}").json()

    assert shared["destination"]["city"] == "Kyoto"
    assert "share_token" not in shared
