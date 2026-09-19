"""Turns what a user types (city, state, country) into real, unambiguous places.

Uses Open-Meteo's free geocoding API (no key). "Paris" alone is many places, so
we return ranked candidates for the user to pick from rather than guessing.
"""

from dataclasses import dataclass

import upstream

SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search"
GET_URL = "https://geocoding-api.open-meteo.com/v1/get"


@dataclass
class Place:
    geoname_id: int
    city: str
    state: str | None
    country: str
    country_code: str
    latitude: float
    longitude: float
    population: int | None = None


def _to_place(raw: dict) -> Place:
    return Place(
        geoname_id=int(raw["id"]),
        city=raw["name"],
        state=raw.get("admin1"),
        country=raw.get("country", ""),
        country_code=(raw.get("country_code") or "").upper(),
        latitude=float(raw["latitude"]),
        longitude=float(raw["longitude"]),
        population=raw.get("population"),
    )


def _matches(text: str | None, wanted: str) -> bool:
    if not text:
        return False
    text, wanted = text.strip().lower(), wanted.strip().lower()
    return text == wanted or text.startswith(wanted)


def search_places(city: str, state: str | None = None, country: str | None = None, limit: int = 8) -> list[Place]:
    """Candidates for `city`, narrowed by country (strictly) and ranked by state
    match, then population. Raises upstream.UpstreamError if the service is down."""
    data = upstream.get_json(
        SEARCH_URL, {"name": city.strip(), "count": 30, "language": "en", "format": "json"}
    )
    places = [_to_place(r) for r in (data.get("results") or [])]

    if country and country.strip():
        wanted = country.strip()
        places = [p for p in places if _matches(p.country, wanted) or p.country_code == wanted.upper()]

    def rank(p: Place):
        state_hit = bool(state and state.strip() and _matches(p.state, state))
        return (not state_hit, -(p.population or 0))

    seen, unique = set(), []
    for p in sorted(places, key=rank):
        if p.geoname_id not in seen:
            seen.add(p.geoname_id)
            unique.append(p)
    return unique[:limit]


def get_place(geoname_id: int) -> Place | None:
    """The one place with this id, or None if it doesn't exist."""
    try:
        raw = upstream.get_json(GET_URL, {"id": geoname_id, "language": "en", "format": "json"})
    except upstream.UpstreamNotFound:
        return None
    if not raw or "id" not in raw:
        return None
    return _to_place(raw)
