import json

import pytest

import guide
import models
import upstream
from tests.fakes import FakeUpstream, sparql_response, sparql_row, summary

KYOTO = {
    "geoname_id": 1857910, "city": "Kyoto", "state": "Kyoto", "country": "Japan", "country_code": "JP",
    "latitude": 35.02107, "longitude": 135.75385,
}


def row(item, name, links, dist, qid, label, **kw):
    return sparql_row(item, name, links, dist, qid, label, **kw)


# ------------------------------------------------------------------ parsing


def test_a_place_listed_under_several_types_appears_once_with_the_most_specific_theme():
    rows = [
        row("Q1", "Kiyomizu-dera", 77, 2.0, "Q570116", "tourist attraction", image="Kiyomizu.jpg"),
        row("Q1", "Kiyomizu-dera", 77, 2.0, "Q5393308", "Buddhist temple"),
    ]

    places = guide.parse_places(rows)

    assert len(places) == 1
    assert places[0]["theme"] == "religious"  # not the generic "landmarks"
    assert places[0]["type"] == "Buddhist temple"
    assert places[0]["image_url"].endswith("Kiyomizu.jpg?width=640")  # image from either row is kept


def test_places_are_ranked_by_how_many_languages_cover_them_and_capped():
    rows = [row(f"Q{i}", f"Place {i}", i, 1.0, "Q33506", "museum") for i in range(1, 30)]

    places = guide.parse_places(rows, limit=5)

    assert [p["sitelinks"] for p in places] == [29, 28, 27, 26, 25]


def test_places_with_no_english_name_are_dropped():
    rows = [row("Q9", "Q123456", 90, 1.0, "Q33506", "museum"), row("Q2", "Real Museum", 10, 1.0, "Q33506", "museum")]

    assert [p["name"] for p in guide.parse_places(rows)] == ["Real Museum"]


def test_rows_with_an_unknown_type_or_missing_fields_are_skipped_not_fatal():
    rows = [row("Q1", "Mystery", 50, 1.0, "Q999999999", "who knows"), {"item": {"value": "x"}}, row("Q2", "Ok", 5, 1.0, "Q22698", "park")]

    assert [p["name"] for p in guide.parse_places(rows)] == ["Ok"]


def test_image_urls_use_commons_and_credit_links_to_the_file_page():
    place = guide.parse_places([row("Q1", "Castle", 10, 1.0, "Q23413", "castle", image="Nijo%20Castle.jpg")])[0]

    assert place["image_url"] == "https://commons.wikimedia.org/wiki/Special:FilePath/Nijo_Castle.jpg?width=640"
    assert place["credit_url"] == "https://commons.wikimedia.org/wiki/File:Nijo_Castle.jpg"


def test_coordinates_and_distance_come_through():
    place = guide.parse_places([row("Q1", "Temple", 10, 3.456, "Q44539", "temple", lon=135.8, lat=35.1)])[0]

    assert (place["longitude"], place["latitude"], place["distance_km"]) == (135.8, 35.1, 3.5)


def test_every_theme_type_id_belongs_to_a_known_theme():
    assert set(guide.TYPE_THEME.values()) <= set(guide.THEME_ORDER)
    assert set(guide.THEME_LABELS) == set(guide.THEME_ORDER)


# --------------------------------------------------------------------- query


def test_the_city_query_has_no_minimum_distance_but_the_around_query_does():
    city = guide.places_query(35.0, 135.7, 0, 15, 10, 36)
    around = guide.places_query(35.0, 135.7, 15, 40, 25, 36)

    assert "FILTER(?dist" not in city
    assert "FILTER(?dist >= 15)" in around
    assert '"15"' in city and '"40"' in around
    assert "Point(135.7 35.0)" in city  # WKT is longitude first
    assert all(f"wd:{q}" in city for q in guide.TYPE_THEME)


# --------------------------------------------------------------- activities


def place(name, theme, links):
    return {"name": name, "theme": theme, "sitelinks": links, "image_url": None, "credit_url": None}


def test_activities_group_places_by_theme_most_popular_theme_first():
    places = [place("A", "museums", 10), place("B", "religious", 50), place("C", "religious", 40), place("D", "museums", 5)]

    activities = guide.derive_activities(places)

    assert [a["theme"] for a in activities] == ["religious", "museums"]
    assert activities[0]["label"] == "Temples, shrines & churches"
    assert activities[0]["places"] == ["B", "C"]


def test_activity_summaries_read_naturally_for_one_two_and_many_places():
    one = guide.derive_activities([place("Solo Zoo", "family", 5)])[0]["summary"]
    two = guide.derive_activities([place("A", "nature", 9), place("B", "nature", 8)])[0]["summary"]
    many = guide.derive_activities([place(n, "history", 10 - i) for i, n in enumerate("ABCDE")])[0]["summary"]

    assert one == "Don't miss Solo Zoo."
    assert "2 notable places" in two and "A, B" in two
    assert "5 notable places" in many and "A, B and C" in many


def test_no_places_means_no_activities():
    assert guide.derive_activities([]) == []


def test_the_gallery_uses_only_places_that_have_photos_and_is_capped():
    places = [dict(place(f"P{i}", "nature", i), image_url=f"u{i}" if i % 2 else None, credit_url="c") for i in range(30)]

    gallery = guide.gallery_from(places, limit=4)

    assert len(gallery) == 4 and all(g["image_url"] for g in gallery)


# ------------------------------------------------------------------- photos


def wiki(monkeypatch, **routes):
    f = FakeUpstream()
    f.on(guide.WIKI_SUMMARY, upstream.UpstreamNotFound("no such page"))  # like Wikipedia: unknown title -> 404
    for suffix, answer in routes.items():
        f.on(guide.WIKI_SUMMARY + suffix, answer, exact=True)
    monkeypatch.setattr(upstream, "get_json", f)
    return f


def test_the_city_photo_tries_city_and_state_first(monkeypatch):
    f = wiki(monkeypatch, **{"Paris%2C_Texas": summary("Paris, Texas", lat=33.66, lon=-95.55)})

    photo = guide.city_photo("Paris", "Texas", "United States", 33.66, -95.55)

    assert photo["title"] == "Paris, Texas"
    assert "Paris%2C_Texas" in f.calls[0][0]


def test_a_page_about_a_different_place_with_the_same_name_is_rejected_by_location(monkeypatch):
    wiki(
        monkeypatch,
        **{
            "Paris%2C_Texas": upstream.UpstreamNotFound("x"),
            "Paris%2C_United_States": upstream.UpstreamNotFound("x"),
            "Paris": summary("Paris", lat=48.85, lon=2.35),  # France!
        },
    )

    assert guide.city_photo("Paris", "Texas", "United States", 33.66, -95.55) is None


def test_disambiguation_pages_are_skipped(monkeypatch):
    wiki(
        monkeypatch,
        **{"Kyoto%2C_Kyoto": summary("Kyoto", type="disambiguation"), "Kyoto%2C_Japan": summary("Kyoto")},
    )

    assert guide.city_photo("Kyoto", "Kyoto", "Japan", 35.02, 135.75)["title"] == "Kyoto"


def test_a_big_original_is_requested_at_960px_and_a_small_one_is_used_as_is():
    big = summary("Big", original_width=3000)
    small = summary("Small", original_width=500)

    assert "/960px-" in guide._sized_thumb(big)
    assert guide._sized_thumb(small) == small["originalimage"]["source"]


def test_the_credit_link_points_at_the_commons_file_page():
    s = summary("Kyoto", image="https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Kyoto%2C_Japan.jpg/330px-Kyoto%2C_Japan.jpg")

    assert guide._credit_from(s) == "https://commons.wikimedia.org/wiki/File:Kyoto%2C_Japan.jpg"


def test_a_state_is_found_under_its_prefecture_name(monkeypatch):
    wiki(
        monkeypatch,
        **{
            "Kyoto": upstream.UpstreamNotFound("x"),
            "Kyoto_Prefecture": summary("Kyoto Prefecture", "Prefecture of Japan", lat=35.2, lon=135.4),
        },
    )

    assert guide.state_photo("Kyoto", "Japan", 35.02, 135.75, city="Kyoto")["title"] == "Kyoto Prefecture"


def test_a_plain_state_name_is_ignored_when_the_page_is_not_about_a_region(monkeypatch):
    """A page that merely shares the state's name (a singer, a village) must not
    stand in for it -- even when it happens to be geographically close."""
    wiki(monkeypatch, **{"Georgia": summary("Georgia", "American singer-songwriter", lat=33.7, lon=-84.4)})

    assert guide.state_photo("Georgia", "United States", 33.7, -84.4, city="Atlanta") is None


def test_a_plain_state_name_is_accepted_when_the_page_describes_a_region(monkeypatch):
    wiki(monkeypatch, **{"Georgia": summary("Georgia (U.S. state)", "State in the Southeastern United States", lat=33.0, lon=-83.5)})

    assert guide.state_photo("Georgia", "United States", 33.7, -84.4, city="Atlanta")["title"] == "Georgia (U.S. state)"


def test_a_region_page_on_the_other_side_of_the_world_is_rejected_by_distance(monkeypatch):
    wiki(monkeypatch, **{"Georgia": summary("Georgia", "Country in the Caucasus", lat=42, lon=43)})

    assert guide.state_photo("Georgia", "United States", 33.7, -84.4, city="Atlanta") is None


def test_the_state_page_must_not_be_the_city_page(monkeypatch):
    wiki(monkeypatch, **{"Kyoto": summary("Kyoto", "city in Japan and prefecture capital")})

    assert guide.state_photo("Kyoto", "Japan", 35.02, 135.75, city="Kyoto") is None


def test_a_flag_is_never_used_as_the_country_photo(monkeypatch):
    flag = "https://upload.wikimedia.org/wikipedia/en/thumb/9/9e/Flag_of_Japan.svg/330px-Flag_of_Japan.svg.png"
    f = FakeUpstream()
    f.on(guide.WIKI_SUMMARY + "Japan", summary("Japan", "Country in East Asia", image=flag), exact=True)
    f.on(guide.WIKI_API, {"query": {"pages": {"1": {"images": [
        {"title": "File:Flag of Japan.svg"}, {"title": "File:Japan location map.png"},
        {"title": "File:Portrait of Emperor.jpg"}, {"title": "File:Mount Fuji from Hakone.jpg"},
    ]}}}})
    monkeypatch.setattr(upstream, "get_json", f)

    photo = guide.country_photo("Japan", 35.0, 135.7)

    assert photo["image_url"] == "https://commons.wikimedia.org/wiki/Special:FilePath/Mount_Fuji_from_Hakone.jpg?width=960"
    assert photo["credit_url"].endswith("File:Mount_Fuji_from_Hakone.jpg")


def test_a_real_lead_photo_is_used_for_the_country_as_is(monkeypatch):
    wiki(monkeypatch, **{"Iceland": summary("Iceland", "Nordic island country", image="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Seljalandsfoss.jpg/330px-Seljalandsfoss.jpg", lat=65, lon=-18)})

    photo = guide.country_photo("Iceland", 64.1, -21.9)

    assert "Seljalandsfoss" in photo["image_url"]


def test_a_country_with_only_a_flag_and_nothing_scenic_has_no_image_but_keeps_its_blurb(monkeypatch):
    f = FakeUpstream()
    f.on(guide.WIKI_SUMMARY + "Japan", summary("Japan", image="https://x/Flag_of_Japan.svg/330px-Flag_of_Japan.svg.png"), exact=True)
    f.on(guide.WIKI_API, {"query": {"pages": {"1": {"images": [{"title": "File:Flag of Japan.svg"}]}}}})
    monkeypatch.setattr(upstream, "get_json", f)

    photo = guide.country_photo("Japan", 35.0, 135.7)

    assert photo["image_url"] is None and photo["title"] == "Japan"


# --------------------------------------------------------------------- build


def full_fake(monkeypatch, sparql=None):
    f = FakeUpstream()
    f.on(guide.WIKI_SUMMARY, upstream.UpstreamNotFound("no such page"))
    f.on(guide.WIKI_SUMMARY + "Kyoto%2C_Kyoto", summary("Kyoto"), exact=True)
    f.on(guide.WIKI_SUMMARY + "Kyoto_Prefecture", summary("Kyoto Prefecture", "Prefecture of Japan", lat=35.2, lon=135.4), exact=True)
    f.on(guide.WIKI_SUMMARY + "Kyoto", upstream.UpstreamNotFound("x"), exact=True)
    f.on(guide.WIKI_SUMMARY + "Japan", summary("Japan", "Country in East Asia", image="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fuji.jpg/330px-Fuji.jpg"), exact=True)
    f.on(guide.WIKIDATA_SPARQL, sparql or [
        sparql_response(row("Q1", "Kiyomizu-dera", 77, 2.0, "Q5393308", "Buddhist temple", image="K.jpg"),
                        row("Q2", "Nijo Castle", 40, 3.0, "Q23413", "castle", image="N.jpg")),
        sparql_response(row("Q3", "Mount Hiei", 30, 20.0, "Q8502", "mountain", image="H.jpg")),
    ])
    monkeypatch.setattr(upstream, "get_json", f)
    return f


def test_build_fills_every_section_and_derives_activities_from_both_rings(monkeypatch):
    full_fake(monkeypatch)
    saved = []

    payload = guide.build_guide(KYOTO, lambda p: saved.append(json.loads(json.dumps(p))))

    assert payload["sections"] == {"photos": "ready", "places_city": "ready", "places_around": "ready"}
    assert payload["photos"]["city"]["title"] == "Kyoto"
    assert payload["photos"]["state"]["title"] == "Kyoto Prefecture"
    assert payload["photos"]["country"]["title"] == "Japan"
    assert [p["name"] for p in payload["places"]["city"]] == ["Kiyomizu-dera", "Nijo Castle"]
    assert [p["name"] for p in payload["places"]["around"]] == ["Mount Hiei"]
    assert {a["theme"] for a in payload["activities"]} == {"religious", "history", "outdoors"}
    assert len(payload["gallery"]) == 3


def test_build_reports_progress_so_the_page_can_show_sections_as_they_arrive(monkeypatch):
    full_fake(monkeypatch)
    snapshots = []

    guide.build_guide(KYOTO, lambda p: snapshots.append(dict(p["sections"])))

    assert snapshots[0] == {"photos": "ready", "places_city": "pending", "places_around": "pending"}
    assert any(s["places_city"] == "ready" and s["places_around"] == "pending" for s in snapshots)
    assert snapshots[-1]["places_around"] == "ready"


def test_a_failing_source_only_marks_its_own_section_unavailable(monkeypatch):
    f = full_fake(monkeypatch)
    f.on(guide.WIKIDATA_SPARQL, upstream.UpstreamError("timeout"))

    payload = guide.build_guide(KYOTO, lambda p: None)

    assert payload["sections"] == {"photos": "ready", "places_city": "unavailable", "places_around": "unavailable"}
    assert payload["photos"]["city"]["title"] == "Kyoto"  # photos survive Wikidata being down
    assert payload["activities"] == []


def test_the_slow_wide_ring_failing_leaves_the_city_places_intact(monkeypatch):
    f = full_fake(monkeypatch)
    f.on(guide.WIKIDATA_SPARQL, [sparql_response(row("Q1", "Kiyomizu-dera", 77, 2.0, "Q5393308", "Buddhist temple")),
                                 upstream.UpstreamError("query timed out")])

    payload = guide.build_guide(KYOTO, lambda p: None)

    assert payload["sections"]["places_city"] == "ready"
    assert payload["sections"]["places_around"] == "unavailable"
    assert [a["theme"] for a in payload["activities"]] == ["religious"]


def test_a_rate_limited_photo_source_is_survivable(monkeypatch):
    f = FakeUpstream()
    f.on(guide.WIKI_SUMMARY, upstream.UpstreamRateLimited("429"))  # Wikipedia says slow down
    f.on(guide.WIKIDATA_SPARQL, sparql_response(row("Q1", "Kiyomizu-dera", 77, 2.0, "Q5393308", "Buddhist temple")))
    monkeypatch.setattr(upstream, "get_json", f)

    payload = guide.build_guide(KYOTO, lambda p: None)

    assert payload["sections"]["photos"] == "unavailable"
    assert payload["sections"]["places_city"] == "ready"
    assert payload["photos"]["city"] is None


def test_the_city_ring_and_the_wider_ring_are_queried_with_the_right_radii(monkeypatch):
    f = full_fake(monkeypatch)

    guide.build_guide(KYOTO, lambda p: None)

    queries = [params["query"] for _, params in f.calls_to(guide.WIKIDATA_SPARQL)]
    assert '"15"' in queries[0] and '"30"' in queries[1] and "FILTER(?dist >= 15)" in queries[1]


def test_a_city_without_a_state_skips_the_state_photo(monkeypatch):
    f = full_fake(monkeypatch)
    f.on(guide.WIKI_SUMMARY + "Singapore%2C_Singapore", upstream.UpstreamNotFound("x"), exact=True)
    f.on(guide.WIKI_SUMMARY + "Singapore", summary("Singapore", "Island country", lat=1.35, lon=103.8), exact=True)
    place = dict(KYOTO, city="Singapore", state=None, country="Singapore", latitude=1.35, longitude=103.8)

    payload = guide.build_guide(place, lambda p: None)

    assert payload["photos"]["state"] is None


# ----------------------------------------------------------------- caching


@pytest.fixture()
def db(db_session_factory):
    session = db_session_factory()
    yield session
    session.close()


def test_the_first_request_builds_and_stores_the_guide(monkeypatch, db):
    full_fake(monkeypatch)

    row = guide.ensure_guide(db, KYOTO)

    assert row.status == "ready"
    stored = json.loads(row.payload)
    assert stored["places"]["city"][0]["name"] == "Kiyomizu-dera"
    assert db.query(models.DestinationGuide).count() == 1


def test_a_fresh_guide_is_served_from_the_database_without_touching_upstream(monkeypatch, db):
    f = full_fake(monkeypatch)
    guide.ensure_guide(db, KYOTO)
    calls_after_build = len(f.calls)

    row = guide.ensure_guide(db, KYOTO)

    assert row.status == "ready" and len(f.calls) == calls_after_build


def test_a_stale_guide_is_rebuilt_but_its_old_content_stays_visible_meanwhile(monkeypatch, db):
    import datetime

    full_fake(monkeypatch)
    row = guide.ensure_guide(db, KYOTO)
    row.updated_at = guide._now() - guide.FRESH_FOR - datetime.timedelta(days=1)
    db.commit()
    monkeypatch.setattr(guide, "RUN_INLINE", False)  # inspect the state *before* the rebuild finishes
    started = []
    monkeypatch.setattr(guide.threading, "Thread", lambda **kw: type("T", (), {"start": lambda self: started.append(kw)})())

    row = guide.ensure_guide(db, KYOTO)

    assert row.status == "building" and started
    assert json.loads(row.payload)["places"]["city"][0]["name"] == "Kiyomizu-dera"


def test_a_guide_already_being_built_is_not_started_twice(monkeypatch, db):
    monkeypatch.setattr(guide, "RUN_INLINE", False)
    started = []
    monkeypatch.setattr(guide.threading, "Thread", lambda **kw: type("T", (), {"start": lambda self: started.append(kw)})())

    guide.ensure_guide(db, KYOTO)
    guide.ensure_guide(db, KYOTO)

    assert len(started) == 1


def test_a_concurrent_request_for_a_guide_someone_else_is_already_building_does_not_start_a_second_build(monkeypatch, db):
    monkeypatch.setattr(guide, "RUN_INLINE", False)
    started = []
    monkeypatch.setattr(guide.threading, "Thread", lambda **kw: type("T", (), {"start": lambda self: started.append(kw)})())
    guide._inflight.add(KYOTO["geoname_id"])  # another worker got there first (before its row was visible)

    row = guide.ensure_guide(db, KYOTO)

    assert started == [] and row.status == "building"


def test_a_build_that_never_finished_is_retried_after_the_timeout(monkeypatch, db):
    import datetime

    monkeypatch.setattr(guide, "RUN_INLINE", False)
    started = []
    monkeypatch.setattr(guide.threading, "Thread", lambda **kw: type("T", (), {"start": lambda self: started.append(kw)})())
    row = guide.ensure_guide(db, KYOTO)
    row.updated_at = guide._now() - guide.BUILD_TIMEOUT - datetime.timedelta(seconds=5)
    db.commit()
    guide._inflight.clear()  # the crashed thread never released its slot

    guide.ensure_guide(db, KYOTO)

    assert len(started) == 2


def test_a_guide_where_every_source_failed_is_marked_failed_and_retried_next_time(monkeypatch, db):
    monkeypatch.setattr(upstream, "get_json", FakeUpstream())  # everything unregistered -> UpstreamError

    row = guide.ensure_guide(db, KYOTO)

    assert row.status == "failed"
    full_fake(monkeypatch)
    assert guide.ensure_guide(db, KYOTO).status == "ready"


def test_an_unexpected_crash_in_the_build_marks_it_failed_instead_of_stuck_building(monkeypatch, db):
    def boom(place, save):
        raise RuntimeError("bug")

    monkeypatch.setattr(guide, "build_guide", boom)

    assert guide.ensure_guide(db, KYOTO).status == "failed"
    assert guide._inflight == set()


def test_the_cover_image_prefers_the_city_photo_then_the_first_place_photo(monkeypatch, db):
    full_fake(monkeypatch)
    row = guide.ensure_guide(db, KYOTO)
    assert "Kyoto" in guide.cover_image(row)

    payload = json.loads(row.payload)
    payload["photos"]["city"] = None
    row.payload = json.dumps(payload)
    assert guide.cover_image(row) == payload["gallery"][0]["image_url"]

    assert guide.cover_image(None) is None
    row.payload = "not json"
    assert guide.cover_image(row) is None
