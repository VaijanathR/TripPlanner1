import pytest

import geocoding
import upstream
from tests.fakes import FakeUpstream, geocode_result

PARIS_FR = geocode_result(1, "Paris", "Île-de-France Region", "France", "FR", 48.85, 2.35, 2_138_551)
PARIS_TX = geocode_result(2, "Paris", "Texas", "United States", "US", 33.66, -95.55, 24_782)
PARIS_TN = geocode_result(3, "Paris", "Tennessee", "United States", "US", 36.30, -88.32, 10_150)


@pytest.fixture()
def fake(monkeypatch):
    f = FakeUpstream().on(geocoding.SEARCH_URL, {"results": [PARIS_TN, PARIS_TX, PARIS_FR]})
    monkeypatch.setattr(upstream, "get_json", f)
    return f


def test_candidates_are_ranked_by_population_when_nothing_narrows_them(fake):
    places = geocoding.search_places("Paris")

    assert [p.geoname_id for p in places] == [1, 2, 3]


def test_a_matching_state_beats_a_bigger_city(fake):
    places = geocoding.search_places("Paris", state="Texas")

    assert places[0].geoname_id == 2  # Paris, Texas ahead of Paris, France


def test_state_matching_is_case_insensitive_and_accepts_a_prefix(fake):
    assert geocoding.search_places("Paris", state="tenn")[0].geoname_id == 3


@pytest.mark.parametrize("typed", ["France", "france", "FR", "fra"])
def test_country_narrows_strictly_by_name_prefix_or_code(fake, typed):
    places = geocoding.search_places("Paris", country=typed)

    assert [p.geoname_id for p in places] == [1]


def test_a_country_with_no_such_city_yields_no_candidates_not_the_wrong_ones(fake):
    assert geocoding.search_places("Paris", country="Japan") == []


def test_state_and_country_together(fake):
    places = geocoding.search_places("Paris", state="Texas", country="United States")

    assert [p.geoname_id for p in places] == [2, 3]


def test_duplicate_ids_and_the_limit_are_respected(monkeypatch):
    many = [geocode_result(i, "Springfield", "S", "United States", "US", 1, 1, 100 - i) for i in range(20)]
    many.append(many[0])
    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.SEARCH_URL, {"results": many}))

    places = geocoding.search_places("Springfield", limit=5)

    assert len(places) == 5 and len({p.geoname_id for p in places}) == 5


def test_no_results_is_an_empty_list(monkeypatch):
    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.SEARCH_URL, {"generationtime_ms": 1}))

    assert geocoding.search_places("Zzzzzzz") == []


def test_the_city_typed_is_what_is_sent_upstream_trimmed(fake):
    geocoding.search_places("  Paris  ")

    assert fake.calls[0][1]["name"] == "Paris"


def test_an_upstream_outage_is_raised_for_the_caller_to_handle(monkeypatch):
    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.SEARCH_URL, upstream.UpstreamError("down")))

    with pytest.raises(upstream.UpstreamError):
        geocoding.search_places("Paris")


def test_get_place_returns_the_place(monkeypatch):
    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.GET_URL, PARIS_TX))

    place = geocoding.get_place(2)

    assert (place.geoname_id, place.city, place.state, place.country_code) == (2, "Paris", "Texas", "US")
    assert (place.latitude, place.longitude) == (33.66, -95.55)


def test_get_place_is_none_for_an_unknown_id(monkeypatch):
    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.GET_URL, upstream.UpstreamNotFound("x")))

    assert geocoding.get_place(999) is None


def test_get_place_is_none_when_the_answer_has_no_place(monkeypatch):
    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.GET_URL, {"error": True}))

    assert geocoding.get_place(999) is None
