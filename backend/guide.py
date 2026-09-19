"""Destination guides: photos, popular places, and things to do for a city.

Built from free, key-less sources: Wikipedia (photos and blurbs), Wikidata
(notable places, ranked by how many languages have an article about them), and
the place types on Wikidata (which we group into themes like "Museums &
galleries" to derive things to do).

A guide is slow to build (Wikidata can take seconds) and the sources rate-limit,
so it is built once in the background, stored in the database, and served from
there. Each section fails on its own: a slow or missing source leaves that one
section "unavailable" and never breaks the rest.
"""

import datetime
import json
import math
import re
import threading
from urllib.parse import quote, unquote

import upstream

WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"
WIKI_API = "https://en.wikipedia.org/w/api.php"

CITY_RADIUS_KM = 15  # "in the city"; ~3-4 s on Wikidata
AROUND_RADIUS_KM = 30  # "around the city"; ~15 s. (40 km is dropped by Wikidata's gateway: 502.)
CITY_MIN_LINKS = 10
AROUND_MIN_LINKS = 20
PLACES_PER_RING = 12
FRESH_FOR = datetime.timedelta(days=30)
BUILD_TIMEOUT = datetime.timedelta(minutes=5)
SPARQL_TIMEOUT = 65.0

# Tests set this so the "background" build runs in the calling thread.
RUN_INLINE = False

# --- place types -> themes ----------------------------------------------------
# Wikidata class ids (all verified against their English labels).
THEME_ORDER = ["religious", "museums", "history", "nature", "outdoors", "family", "shows", "landmarks"]

THEME_LABELS = {
    "religious": "Temples, shrines & churches",
    "museums": "Museums & galleries",
    "history": "Castles, palaces & historic sites",
    "nature": "Parks, gardens & nature",
    "outdoors": "Hikes & viewpoints",
    "family": "Family fun",
    "shows": "Shows & performances",
    "landmarks": "Landmarks & sightseeing",
}

TYPE_THEME = {
    "Q44539": "religious", "Q5393308": "religious", "Q845945": "religious", "Q16970": "religious",
    "Q2977": "religious", "Q32815": "religious", "Q34627": "religious", "Q160742": "religious",
    "Q33506": "museums", "Q207694": "museums",
    "Q23413": "history", "Q57821": "history", "Q16560": "history", "Q839954": "history",
    "Q4989906": "history", "Q1081138": "history",
    "Q22698": "nature", "Q1107656": "nature", "Q46169": "nature", "Q40080": "nature",
    "Q8502": "outdoors",
    "Q43501": "family", "Q194195": "family",
    "Q24354": "shows", "Q1329623": "shows",
    "Q570116": "landmarks", "Q12518": "landmarks", "Q12280": "landmarks", "Q179700": "landmarks",
    "Q483110": "landmarks",
}

_IMAGE_SKIP = re.compile(
    r"flag|coat[_ ]of[_ ]arms|emblem|seal[_ ]of|locator|location[_ ]map|orthographic|"
    r"\bmap\b|_map|map_|portrait|signature|logo|icon|symbol|diagram|chart|graph",
    re.I,
)


# --- helpers ------------------------------------------------------------------


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def commons_file_url(filename: str, width: int = 640) -> str:
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{quote(filename.replace(' ', '_'))}?width={width}"


def commons_page_url(filename: str) -> str:
    return f"https://commons.wikimedia.org/wiki/File:{quote(filename.replace(' ', '_'))}"


_THUMB_WIDTHS_OK = 960


def _sized_thumb(summary: dict) -> str | None:
    """A ~960px image URL for a Wikipedia summary, without asking for a size
    bigger than the original (Wikimedia refuses that)."""
    original = summary.get("originalimage") or {}
    thumb = summary.get("thumbnail") or {}
    if original.get("source") and (original.get("width") or 0) <= _THUMB_WIDTHS_OK:
        return original["source"]
    src = thumb.get("source")
    if src and re.search(r"/\d+px-", src):
        return re.sub(r"/\d+px-", f"/{_THUMB_WIDTHS_OK}px-", src, count=1)
    return original.get("source") or src


def _file_from_thumb_url(url: str | None) -> str | None:
    if not url:
        return None
    m = re.search(r"/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/]+)", url)
    return unquote(m.group(1)) if m else None


# --- photos (Wikipedia) -------------------------------------------------------


def _summary(title: str) -> dict | None:
    try:
        data = upstream.get_json(WIKI_SUMMARY + quote(title.replace(" ", "_"), safe=""))
    except upstream.UpstreamNotFound:
        return None
    if data.get("type") != "standard":  # disambiguation pages etc.
        return None
    return data


def _photo_from_summary(summary: dict, image_url: str | None, credit_url: str | None = None) -> dict:
    page_url = (summary.get("content_urls") or {}).get("desktop", {}).get("page")
    return {
        "title": summary.get("title"),
        "description": summary.get("description"),
        "extract": summary.get("extract"),
        "image_url": image_url,
        "credit_url": credit_url or page_url,
        "page_url": page_url,
    }


def _scenic_image_from_article(title: str) -> tuple[str, str] | None:
    """First real photo in an article (not a flag, map, portrait...). For
    countries, whose lead image is usually a flag."""
    data = upstream.get_json(
        WIKI_API,
        {"action": "query", "titles": title, "prop": "images", "imlimit": 60, "format": "json"},
    )
    for page in (data.get("query", {}).get("pages") or {}).values():
        for img in page.get("images", []):
            name = img["title"].removeprefix("File:")
            if name.lower().endswith((".jpg", ".jpeg")) and not _IMAGE_SKIP.search(name):
                return commons_file_url(name, 960), commons_page_url(name)
    return None


def _near(summary: dict, lat: float, lon: float, max_km: float) -> bool:
    c = summary.get("coordinates")
    if not c:
        return True  # can't check; don't reject on missing data
    return distance_km(lat, lon, c["lat"], c["lon"]) <= max_km


def city_photo(city: str, state: str | None, country: str, lat: float, lon: float) -> dict | None:
    candidates = [f"{city}, {state}" if state else None, f"{city}, {country}", city]
    for title in [c for c in candidates if c]:
        s = _summary(title)
        if s and _near(s, lat, lon, 60):
            return _photo_from_summary(s, _sized_thumb(s), _credit_from(s))
    return None


_STATE_SUFFIXES = ["", " Prefecture", " (state)", " State", " Province", " Region", " County", " Department"]
_STATE_WORDS = re.compile(
    r"state|province|prefecture|region|county|territory|department|canton|oblast|governorate|"
    r"district|emirate|voivodeship|division|republic|land of|federal",
    re.I,
)


def state_photo(state: str, country: str, lat: float, lon: float, city: str) -> dict | None:
    for suffix in _STATE_SUFFIXES:
        title = f"{state}{suffix}"
        s = _summary(title)
        if not s or s.get("title", "").lower() == city.lower():
            continue
        if suffix == "" and not _STATE_WORDS.search(s.get("description") or ""):
            continue  # plain name might be a city or person with the same name
        if _near(s, lat, lon, 1200):
            return _photo_from_summary(s, _sized_thumb(s), _credit_from(s))
    return None


def country_photo(country: str, lat: float, lon: float) -> dict | None:
    s = _summary(country)
    if not s or not _near(s, lat, lon, 6000):
        return None
    image, credit = _sized_thumb(s), _credit_from(s)
    if not image or _IMAGE_SKIP.search(image):  # usually a flag or a map
        try:
            scenic = _scenic_image_from_article(s["title"])
        except upstream.UpstreamError:
            scenic = None
        image, credit = scenic if scenic else (None, None)
    return _photo_from_summary(s, image, credit)


def _credit_from(summary: dict) -> str | None:
    f = _file_from_thumb_url((summary.get("thumbnail") or {}).get("source"))
    return commons_page_url(f) if f else None


# --- places (Wikidata) --------------------------------------------------------


def places_query(lat: float, lon: float, min_km: float, max_km: float, min_links: int, limit: int) -> str:
    types = " ".join(f"wd:{q}" for q in TYPE_THEME)
    dist_filter = f"FILTER(?dist >= {min_km})" if min_km else ""
    return f"""SELECT ?item ?itemLabel ?itemDescription ?sitelinks ?dist ?coord ?type ?typeLabel ?image WHERE {{
  SERVICE wikibase:around {{
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point({lon} {lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "{max_km}" .
    bd:serviceParam wikibase:distance ?dist .
  }}
  ?item wikibase:sitelinks ?sitelinks . FILTER(?sitelinks >= {min_links}) {dist_filter}
  ?item wdt:P31 ?type . VALUES ?type {{ {types} }}
  OPTIONAL {{ ?item wdt:P18 ?image }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}} ORDER BY DESC(?sitelinks) LIMIT {limit}"""


def _theme_rank(theme: str) -> int:
    return THEME_ORDER.index(theme)


def parse_places(rows: list[dict], limit: int = PLACES_PER_RING) -> list[dict]:
    """Collapse SPARQL rows (one per type per place) into one dict per place."""
    by_item: dict[str, dict] = {}
    for row in rows:
        try:
            item = row["item"]["value"]
            qid = row["type"]["value"].rsplit("/", 1)[-1]
            theme = TYPE_THEME[qid]
            name = row["itemLabel"]["value"]
        except KeyError:
            continue
        if re.fullmatch(r"Q\d+", name):  # unlabeled in English: not useful to show
            continue
        m = re.match(r"Point\(([-\d.eE+]+) ([-\d.eE+]+)\)", row.get("coord", {}).get("value", ""))
        image = row.get("image", {}).get("value")
        filename = unquote(image.rsplit("/", 1)[-1]) if image else None
        candidate = {
            "id": item.rsplit("/", 1)[-1],
            "name": name,
            "description": row.get("itemDescription", {}).get("value"),
            "type": row.get("typeLabel", {}).get("value"),
            "theme": theme,
            "sitelinks": int(float(row["sitelinks"]["value"])),
            "distance_km": round(float(row["dist"]["value"]), 1) if "dist" in row else None,
            "longitude": float(m.group(1)) if m else None,
            "latitude": float(m.group(2)) if m else None,
            "image_url": commons_file_url(filename, 640) if filename else None,
            "credit_url": commons_page_url(filename) if filename else None,
            "wikidata_url": item,
        }
        existing = by_item.get(item)
        if existing is None:
            by_item[item] = candidate
        else:  # same place under several types: keep the more specific theme
            if _theme_rank(candidate["theme"]) < _theme_rank(existing["theme"]):
                existing.update(theme=candidate["theme"], type=candidate["type"])
            existing["image_url"] = existing["image_url"] or candidate["image_url"]
            existing["credit_url"] = existing["credit_url"] or candidate["credit_url"]
    places = sorted(by_item.values(), key=lambda p: -p["sitelinks"])
    return places[:limit]


def fetch_places(lat: float, lon: float, min_km: float, max_km: float, min_links: int) -> list[dict]:
    query = places_query(lat, lon, min_km, max_km, min_links, limit=PLACES_PER_RING * 3)
    data = upstream.get_json(WIKIDATA_SPARQL, {"format": "json", "query": query}, timeout=SPARQL_TIMEOUT)
    return parse_places(data.get("results", {}).get("bindings", []))


# --- things to do -------------------------------------------------------------


def derive_activities(places: list[dict]) -> list[dict]:
    """Group notable places by theme into things to do, most popular first."""
    groups: dict[str, list[dict]] = {}
    for place in places:
        groups.setdefault(place["theme"], []).append(place)
    activities = []
    for theme, members in groups.items():
        members.sort(key=lambda p: -p["sitelinks"])
        names = [m["name"] for m in members]
        highlights = ", ".join(names[:3]) if len(names) <= 2 else ", ".join(names[:2]) + f" and {names[2]}"
        activities.append(
            {
                "theme": theme,
                "label": THEME_LABELS[theme],
                "summary": f"{len(members)} notable {'place' if len(members) == 1 else 'places'} to explore, "
                f"including {highlights}." if len(names) > 1 else f"Don't miss {names[0]}.",
                "places": [m["name"] for m in members[:6]],
                "score": sum(m["sitelinks"] for m in members),
            }
        )
    activities.sort(key=lambda a: -a["score"])
    return activities


def gallery_from(places: list[dict], limit: int = 6) -> list[dict]:
    photos = [
        {"title": p["name"], "image_url": p["image_url"], "credit_url": p["credit_url"]}
        for p in places
        if p.get("image_url")
    ]
    return photos[:limit]


# --- building and storing ------------------------------------------------------


def _new_payload() -> dict:
    return {
        "photos": {"city": None, "state": None, "country": None},
        "gallery": [],
        "places": {"city": [], "around": []},
        "activities": [],
        "sections": {"photos": "pending", "places_city": "pending", "places_around": "pending"},
    }


def build_guide(place: dict, save) -> dict:
    """Fill in a guide section by section. `save(payload)` is called after each
    section so the page can show results as they arrive. A section whose source
    fails is marked "unavailable"; the others carry on."""
    payload = _new_payload()
    lat, lon = place["latitude"], place["longitude"]
    sections = payload["sections"]

    def guarded(section: str, work):
        try:
            work()
            sections[section] = "ready"
        except upstream.UpstreamError:
            sections[section] = "unavailable"
        save(payload)

    def photos():
        p = payload["photos"]
        p["city"] = city_photo(place["city"], place.get("state"), place["country"], lat, lon)
        if place.get("state"):
            p["state"] = state_photo(place["state"], place["country"], lat, lon, place["city"])
        p["country"] = country_photo(place["country"], lat, lon)

    def city_places():
        payload["places"]["city"] = fetch_places(lat, lon, 0, CITY_RADIUS_KM, CITY_MIN_LINKS)

    def around_places():
        payload["places"]["around"] = fetch_places(lat, lon, CITY_RADIUS_KM, AROUND_RADIUS_KM, AROUND_MIN_LINKS)

    def refresh_derived():
        every = payload["places"]["city"] + payload["places"]["around"]
        payload["activities"] = derive_activities(every)
        payload["gallery"] = gallery_from(every)

    guarded("photos", photos)
    guarded("places_city", city_places)
    refresh_derived()
    save(payload)
    guarded("places_around", around_places)
    refresh_derived()
    save(payload)
    return payload


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _aware(dt: datetime.datetime | None) -> datetime.datetime | None:
    return dt.replace(tzinfo=datetime.UTC) if dt is not None and dt.tzinfo is None else dt


_inflight: set[int] = set()
_inflight_lock = threading.Lock()


def _run_build(session_factory, geoname_id: int, place: dict) -> None:
    import models  # local: models imports database, keep module import light

    db = session_factory()
    try:
        row = db.query(models.DestinationGuide).filter_by(geoname_id=geoname_id).one()

        def save(payload: dict) -> None:
            row.payload = json.dumps(payload)
            row.updated_at = _now()
            db.commit()

        final = build_guide(place, save)
        s = final["sections"]
        row.status = "failed" if all(v == "unavailable" for v in s.values()) else "ready"
        row.updated_at = _now()
        db.commit()
    except Exception:  # never let a background thread die silently mid-"building"
        db.rollback()
        row = db.query(models.DestinationGuide).filter_by(geoname_id=geoname_id).first()
        if row is not None:
            row.status = "failed"
            db.commit()
    finally:
        db.close()
        with _inflight_lock:
            _inflight.discard(geoname_id)


def ensure_guide(db, place: dict):
    """The stored guide row for this place, starting a background build if it is
    missing, failed, or stale. Never blocks on the upstream sources."""
    import models
    from sqlalchemy.orm import sessionmaker

    geoname_id = place["geoname_id"]
    row = db.query(models.DestinationGuide).filter_by(geoname_id=geoname_id).first()
    now = _now()
    if row is not None:
        updated = _aware(row.updated_at) or now
        building = row.status == "building" and now - updated < BUILD_TIMEOUT
        fresh = row.status == "ready" and now - updated < FRESH_FOR
        if building or fresh:
            return row
    else:
        row = models.DestinationGuide(geoname_id=geoname_id)
        db.add(row)
    stale_payload = row.payload  # keep showing the old content while rebuilding
    row.status = "building"
    row.updated_at = now
    row.payload = stale_payload or json.dumps(_new_payload())
    db.commit()

    with _inflight_lock:
        if geoname_id in _inflight:
            return row
        _inflight.add(geoname_id)
    factory = sessionmaker(bind=db.get_bind(), autoflush=False)
    if RUN_INLINE:
        _run_build(factory, geoname_id, place)
        db.refresh(row)
    else:
        threading.Thread(target=_run_build, args=(factory, geoname_id, place), daemon=True).start()
    return row


def cover_image(row) -> str | None:
    """A photo to represent a trip going here: the city photo, else the first place photo."""
    if row is None or not row.payload:
        return None
    try:
        payload = json.loads(row.payload)
    except ValueError:
        return None
    city = (payload.get("photos") or {}).get("city") or {}
    if city.get("image_url"):
        return city["image_url"]
    gallery = payload.get("gallery") or []
    return gallery[0]["image_url"] if gallery else None


def guide_response(row, place: dict) -> dict:
    payload = json.loads(row.payload) if row.payload else _new_payload()
    return {"status": row.status, "destination": place, **payload}
