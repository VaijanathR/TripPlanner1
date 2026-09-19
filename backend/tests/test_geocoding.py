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


# ---------------------------------------------------------------------------
# Forgiving input: aliases, abbreviations, run-together names
# ---------------------------------------------------------------------------

LV_NV = geocode_result(10, "Las Vegas", "Nevada", "United States", "US", 36.17, -115.14, 641_903)
LV_NM = geocode_result(11, "Las Vegas", "New Mexico", "United States", "US", 35.59, -105.22, 13_000)
LV_VE = geocode_result(12, "Las Vegas", "Cojedes", "Venezuela", "VE", 9.6, -68.4, 1_000)
LONDON_GB = geocode_result(20, "London", "England", "United Kingdom", "GB", 51.5, -0.12, 8_900_000)
LONDON_CA = geocode_result(21, "London", "Ontario", "Canada", "CA", 42.98, -81.25, 400_000)


def geocoder(monkeypatch, by_name):
    """A geocoder that knows names exactly as spelled, like the real one: a name
    it doesn't list gets no results."""
    fake = FakeUpstream().on(
        geocoding.SEARCH_URL, lambda url, params: {"results": by_name.get(params["name"].lower(), [])}
    )
    monkeypatch.setattr(upstream, "get_json", fake)
    return fake


LAS_PAGE = [
    geocode_result(50, "Las Palmas", "Canary Islands", "Spain", "ES", 28.1, -15.4, 380_000),
    LV_NV, LV_NM, LV_VE,
    geocode_result(51, "Lassen", "California", "United States", "US", 40.4, -121.3, 900),
]


@pytest.fixture()
def vegas(monkeypatch):
    # Like the real geocoder: knows "las vegas" and lists Las* cities for "las", but not "lasvegas".
    return geocoder(monkeypatch, {"las vegas": [LV_NV, LV_NM, LV_VE], "las": LAS_PAGE})


def ids(places):
    return [p.geoname_id for p in places]


@pytest.mark.parametrize(
    "typed",
    ["USA", "usa", "U.S.A.", "US", "us", "United States", "united states of america", "America", " USA "],
)
def test_the_many_ways_of_writing_the_united_states_all_work(vegas, typed):
    assert ids(geocoding.search_places("Las Vegas", country=typed)) == [10, 11]


@pytest.mark.parametrize("typed", ["UK", "U.K.", "GBR", "Great Britain", "Britain", "england", "United Kingdom", "united"])
def test_the_many_ways_of_writing_the_united_kingdom_all_work(monkeypatch, typed):
    geocoder(monkeypatch, {"london": [LONDON_CA, LONDON_GB]})

    assert ids(geocoding.search_places("London", country=typed)) == [20]


def test_a_three_letter_country_code_works(monkeypatch):
    geocoder(monkeypatch, {"london": [LONDON_CA, LONDON_GB]})

    assert ids(geocoding.search_places("London", country="CAN")) == [21]


def test_a_run_together_city_name_finds_its_place(vegas):
    assert ids(geocoding.search_places("lasvegas")) == [10, 11, 12]


def test_the_exact_entry_that_used_to_fail_now_finds_las_vegas_nevada_first(vegas):
    places = geocoding.search_places("lasvegas", state="nevada", country="USA")

    assert ids(places) == [10, 11]
    assert (places[0].city, places[0].state) == ("Las Vegas", "Nevada")


def test_capitalisation_and_stray_spaces_in_a_run_together_name_do_not_matter(vegas):
    assert ids(geocoding.search_places("  LasVegas ")) == [10, 11, 12]


def test_a_wrongly_understood_run_together_name_still_finds_the_real_place(monkeypatch):
    """'newyork' is a real (tiny) village in Scotland, but the user meant New York."""
    village = geocode_result(30, "Newyork", "Scotland", "United Kingdom", "GB", 55.0, -3.0, 50)
    nyc = geocode_result(31, "New York", "New York", "United States", "US", 40.71, -74.0, 8_800_000)
    noise = geocode_result(32, "Newark", "New Jersey", "United States", "US", 40.7, -74.2, 300_000)
    geocoder(monkeypatch, {"newyork": [village], "new": [noise, nyc]})

    places = geocoding.search_places("newyork")

    assert ids(places) == [31, 30]  # the big city first, the village still offered; Newark filtered out


def test_only_places_whose_whole_name_matches_are_taken_from_the_prefix_lookup(vegas):
    places = geocoding.search_places("lasvegas")

    assert 50 not in ids(places) and 51 not in ids(places)  # Las Palmas, Lassen


def test_a_run_together_name_costs_exactly_one_extra_lookup(vegas):
    geocoding.search_places("lasvegas")

    assert [c[1]["name"] for c in vegas.calls] == ["lasvegas", "las"]


def test_the_prefix_lookup_is_skipped_when_the_geocoder_already_answered_well(monkeypatch):
    many = [geocode_result(i, "Springfield", "S", "United States", "US", 1, 1, 1000 - i) for i in range(8)]
    fake = geocoder(monkeypatch, {"springfield": many})

    geocoding.search_places("Springfield")

    assert len(fake.calls) == 1


def test_a_name_that_already_has_a_space_gets_no_extra_lookup(monkeypatch):
    fake = geocoder(monkeypatch, {"nowhere town": []})

    assert geocoding.search_places("Nowhere Town") == []
    assert len(fake.calls) == 1


def test_a_very_short_name_gets_no_extra_lookup(monkeypatch):
    fake = geocoder(monkeypatch, {"rome": []})

    geocoding.search_places("Rome")

    assert len(fake.calls) == 1


def test_a_failing_prefix_lookup_does_not_fail_the_search(monkeypatch):
    def answer(url, params):
        if params["name"].lower() == "lasvegas":
            return {"results": [LV_NV]}
        raise upstream.UpstreamError("boom")

    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.SEARCH_URL, answer))

    assert ids(geocoding.search_places("lasvegas")) == [10]  # keeps what the first lookup found


def test_a_failing_prefix_lookup_is_an_error_when_the_first_lookup_found_nothing(monkeypatch):
    """Otherwise a timeout would read as "no such place" and send the user off to fix a correct entry."""
    def answer(url, params):
        if params["name"].lower() == "lasvegas":
            return {}
        raise upstream.UpstreamError("timed out")

    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.SEARCH_URL, answer))

    with pytest.raises(upstream.UpstreamError):
        geocoding.search_places("lasvegas")


def test_every_geocoder_call_has_a_short_timeout(monkeypatch, vegas):
    seen = []

    def spy(url, params=None, timeout=8.0):
        seen.append(timeout)
        return vegas(url, params, timeout)

    monkeypatch.setattr(upstream, "get_json", spy)

    geocoding.search_places("lasvegas")

    assert len(seen) == 2 and all(t == geocoding.SEARCH_TIMEOUT for t in seen)


def test_the_geocoder_being_down_for_the_first_lookup_is_still_an_error(monkeypatch):
    monkeypatch.setattr(upstream, "get_json", FakeUpstream().on(geocoding.SEARCH_URL, upstream.UpstreamError("down")))

    with pytest.raises(upstream.UpstreamError):
        geocoding.search_places("lasvegas")


@pytest.mark.parametrize("typed", ["NV", "nv", "Nv", "nevada", "Nev"])
def test_a_state_can_be_typed_as_an_abbreviation_or_a_name(vegas, typed):
    assert geocoding.search_places("Las Vegas", state=typed, country="USA")[0].geoname_id == 10


def test_a_different_state_abbreviation_boosts_that_state_instead(vegas):
    assert geocoding.search_places("Las Vegas", state="NM", country="USA")[0].geoname_id == 11


def test_a_state_abbreviation_only_means_a_us_or_canadian_state(monkeypatch):
    """"NV" must not be read as Nevada for a place in Venezuela."""
    nv_named = geocode_result(40, "Springfield", "Nv Region", "Somewhere", "SW", 1, 1, 10)
    us = geocode_result(41, "Springfield", "Nevada", "United States", "US", 1, 1, 5)
    geocoder(monkeypatch, {"springfield": [nv_named, us]})

    assert geocoding.search_places("Springfield", state="NV")[0].geoname_id == 40  # literal prefix wins there
    assert geocoding.search_places("Springfield", state="Nevada")[0].geoname_id == 41


def test_a_state_never_filters_only_ranks(vegas):
    assert ids(geocoding.search_places("Las Vegas", state="Atlantis", country="USA")) == [10, 11]


@pytest.mark.parametrize(
    "text,expected",
    [("Zürich", "zurich"), ("Las Vegas", "lasvegas"), ("U.S.A.", "usa"), ("  São  Paulo ", "saopaulo"), ("", ""), (None, "")],
)
def test_normalisation_ignores_case_accents_spaces_and_punctuation(text, expected):
    assert geocoding._norm(text) == expected


def test_when_the_country_matches_nothing_the_same_named_places_elsewhere_are_offered(vegas):
    candidates, alternatives = geocoding.search_with_alternatives("Las Vegas", country="Japan")

    assert candidates == []
    assert ids(alternatives) == [10, 11, 12]


def test_an_unrecognised_country_gets_alternatives_not_a_dead_end(vegas):
    candidates, alternatives = geocoding.search_with_alternatives("Las Vegas", state="Nevada", country="Nevada")

    assert candidates == [] and ids(alternatives)[0] == 10


def test_no_alternatives_are_given_when_something_matched(vegas):
    candidates, alternatives = geocoding.search_with_alternatives("Las Vegas", country="USA")

    assert ids(candidates) == [10, 11] and alternatives == []


def test_alternatives_are_only_places_with_the_same_name_and_are_capped(monkeypatch):
    same = [geocode_result(100 + i, "Springfield", "S", "Country %d" % i, "C%d" % i, 1, 1, i) for i in range(9)]
    other = geocode_result(200, "Springfieldton", "S", "Elsewhere", "EW", 1, 1, 999_999)
    geocoder(monkeypatch, {"springfield": same + [other]})

    _, alternatives = geocoding.search_with_alternatives("Springfield", country="Japan")

    assert len(alternatives) == 5 and 200 not in ids(alternatives)


def test_nothing_at_all_found_means_no_candidates_and_no_alternatives(monkeypatch):
    geocoder(monkeypatch, {})

    assert geocoding.search_with_alternatives("Zzzzzz", country="USA") == ([], [])
