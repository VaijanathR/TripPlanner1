"""Turns what a user types (city, state, country) into real, unambiguous places.

Uses Open-Meteo's free geocoding API (no key). "Paris" alone is many places, so
we return ranked candidates for the user to pick from rather than guessing.

People type things the geocoder doesn't understand: "USA" for the United States,
"NV" for Nevada, "lasvegas" for Las Vegas. This module forgives those, so a
reasonable entry finds its place.
"""

import unicodedata
from dataclasses import dataclass

import upstream

SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search"
GET_URL = "https://geocoding-api.open-meteo.com/v1/get"

# Below this many raw results the geocoder probably didn't understand a run-together name.
FEW_RESULTS = 5


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


def _norm(text: str | None) -> str:
    """Lower-case, accent-free, letters and digits only: "Zürich" == "zurich",
    "Las Vegas" == "lasvegas", "U.S.A." == "usa"."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed.casefold() if c.isalnum() and not unicodedata.combining(c))


# What people call countries -> ISO 3166 alpha-2. (Keys are normalised.)
_COUNTRY_ALIASES = {
    "usa": "US", "us": "US", "unitedstates": "US", "unitedstatesofamerica": "US", "america": "US",
    "uk": "GB", "unitedkingdom": "GB", "greatbritain": "GB", "britain": "GB", "england": "GB",
    "scotland": "GB", "wales": "GB", "northernireland": "GB", "gbr": "GB",
    "uae": "AE", "emirates": "AE", "arg": "AR", "aus": "AU", "aut": "AT", "bel": "BE", "bra": "BR",
    "can": "CA", "che": "CH", "chl": "CL", "chn": "CN", "col": "CO", "cub": "CU", "cze": "CZ",
    "deu": "DE", "dnk": "DK", "dom": "DO", "egy": "EG", "esp": "ES", "fin": "FI", "fra": "FR",
    "grc": "GR", "hrv": "HR", "hun": "HU", "idn": "ID", "ind": "IN", "irl": "IE", "isl": "IS",
    "isr": "IL", "ita": "IT", "jam": "JM", "jpn": "JP", "ken": "KE", "kor": "KR", "lka": "LK",
    "mar": "MA", "mex": "MX", "mys": "MY", "nld": "NL", "nor": "NO", "npl": "NP", "nzl": "NZ",
    "pak": "PK", "per": "PE", "phl": "PH", "pol": "PL", "prt": "PT", "rou": "RO", "rus": "RU",
    "sau": "SA", "sgp": "SG", "swe": "SE", "tha": "TH", "tur": "TR", "tza": "TZ", "ukr": "UA",
    "vnm": "VN", "zaf": "ZA", "bgd": "BD",
    "holland": "NL", "hollandnetherlands": "NL", "korea": "KR", "southkorea": "KR",
    "northkorea": "KP", "russia": "RU", "czechia": "CZ", "czechrepublic": "CZ",
    "ivorycoast": "CI", "burma": "MM", "turkiye": "TR", "swaziland": "SZ", "macedonia": "MK",
    "uaeemirates": "AE", "vietnam": "VN", "laos": "LA", "syria": "SY", "iran": "IR",
    "bolivia": "BO", "venezuela": "VE", "tanzania": "TZ", "moldova": "MD", "taiwan": "TW",
    "hongkong": "HK", "macau": "MO", "capeverde": "CV", "palestine": "PS",
}

_US_STATES = {
    "al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas", "ca": "california",
    "co": "colorado", "ct": "connecticut", "de": "delaware", "fl": "florida", "ga": "georgia",
    "hi": "hawaii", "id": "idaho", "il": "illinois", "in": "indiana", "ia": "iowa", "ks": "kansas",
    "ky": "kentucky", "la": "louisiana", "me": "maine", "md": "maryland", "ma": "massachusetts",
    "mi": "michigan", "mn": "minnesota", "ms": "mississippi", "mo": "missouri", "mt": "montana",
    "ne": "nebraska", "nv": "nevada", "nh": "newhampshire", "nj": "newjersey", "nm": "newmexico",
    "ny": "newyork", "nc": "northcarolina", "nd": "northdakota", "oh": "ohio", "ok": "oklahoma",
    "or": "oregon", "pa": "pennsylvania", "ri": "rhodeisland", "sc": "southcarolina",
    "sd": "southdakota", "tn": "tennessee", "tx": "texas", "ut": "utah", "vt": "vermont",
    "va": "virginia", "wa": "washington", "wv": "westvirginia", "wi": "wisconsin", "wy": "wyoming",
    "dc": "districtofcolumbia",
}
_CA_PROVINCES = {
    "ab": "alberta", "bc": "britishcolumbia", "mb": "manitoba", "nb": "newbrunswick",
    "nl": "newfoundlandandlabrador", "ns": "novascotia", "on": "ontario", "pe": "princeedwardisland",
    "qc": "quebec", "sk": "saskatchewan", "nt": "northwestterritories", "nu": "nunavut", "yt": "yukon",
}
_STATE_ABBREVIATIONS = {**_CA_PROVINCES, **_US_STATES}


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


def _country_matches(place: Place, typed: str) -> bool:
    wanted = _norm(typed)
    if not wanted:
        return True
    code = _COUNTRY_ALIASES.get(wanted)
    if code is not None:
        return place.country_code == code
    if place.country_code == typed.strip().upper():
        return True
    name = _norm(place.country)
    return name.startswith(wanted) or (len(wanted) >= 4 and wanted in name)


def _state_matches(place: Place, typed: str) -> bool:
    wanted = _norm(typed)
    if not wanted or not place.state:
        return False
    # "NV" means Nevada, but only for the countries that use such abbreviations.
    wanted = _STATE_ABBREVIATIONS.get(wanted, wanted) if place.country_code in {"US", "CA"} else wanted
    name = _norm(place.state)
    return name == wanted or name.startswith(wanted)


def _fetch(name: str) -> list[Place]:
    data = upstream.get_json(
        SEARCH_URL, {"name": name.strip(), "count": 100, "language": "en", "format": "json"}, timeout=SEARCH_TIMEOUT
    )
    return [_to_place(r) for r in (data.get("results") or [])]


SEARCH_TIMEOUT = 5.0  # seconds per attempt (upstream retries a dropped connection once)
PREFIX_LENGTH = 3  # measured: the first 3 letters find the right city for run-together names


def _find_candidates(city: str) -> list[Place]:
    """Everything the geocoder knows under this name, with one extra lookup for
    run-together names it can't parse ("lasvegas" -> nothing, but its first three
    letters "las" list Las Vegas, which we then match against the full name)."""
    raw = _fetch(city)
    wanted = _norm(city)
    exact = [p for p in raw if _norm(p.city) == wanted]
    text = city.strip()
    if (exact and len(raw) >= FEW_RESULTS) or " " in text or len(text) <= PREFIX_LENGTH + 1:
        return raw

    try:
        by_prefix = [p for p in _fetch(text[:PREFIX_LENGTH]) if _norm(p.city) == wanted]
    except upstream.UpstreamError:
        if exact:
            return raw  # the extra lookup was only a bonus; we already have an answer
        raise  # nothing found so far AND the fallback failed: say "try again", not "no such place"
    return raw + by_prefix


def _rank_and_dedupe(places: list[Place], state: str | None, limit: int) -> list[Place]:
    def rank(p: Place):
        state_hit = bool(state and state.strip() and _state_matches(p, state))
        return (not state_hit, -(p.population or 0))

    seen, unique = set(), []
    for p in sorted(places, key=rank):
        if p.geoname_id not in seen:
            seen.add(p.geoname_id)
            unique.append(p)
    return unique[:limit]


def search_with_alternatives(
    city: str, state: str | None = None, country: str | None = None, limit: int = 8
) -> tuple[list[Place], list[Place]]:
    """(candidates, alternatives). Candidates match everything typed; country is
    a strict filter. If none do, alternatives are the same-named places in other
    countries, so the user can see what exists instead of a dead end.
    Raises upstream.UpstreamError if the geocoder is down."""
    everything = _find_candidates(city)
    if country and country.strip():
        matching = [p for p in everything if _country_matches(p, country)]
    else:
        matching = everything
    candidates = _rank_and_dedupe(matching, state, limit)
    if candidates:
        return candidates, []
    wanted = _norm(city)
    same_name = [p for p in everything if _norm(p.city) == wanted]
    return [], _rank_and_dedupe(same_name, state, 5)


def search_places(city: str, state: str | None = None, country: str | None = None, limit: int = 8) -> list[Place]:
    return search_with_alternatives(city, state, country, limit)[0]


def get_place(geoname_id: int) -> Place | None:
    """The one place with this id, or None if it doesn't exist."""
    try:
        raw = upstream.get_json(GET_URL, {"id": geoname_id, "language": "en", "format": "json"})
    except (upstream.UpstreamNotFound, upstream.UpstreamBadRequest):
        # Open-Meteo answers 400, not 404, for an id that doesn't exist.
        return None
    if not raw or "id" not in raw:
        return None
    return _to_place(raw)
