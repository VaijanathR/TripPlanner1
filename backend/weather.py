"""Maps/weather upstream integration.

Only backend/routers/conditions.py may import this module (per
backend-spec.md: the frontend never calls the upstream API directly,
and only the backend does; this module is that one call site). The
default provider is Open-Meteo, which needs no API key. If a keyed
provider is ever added, its key is read here from server-side config
only, never returned to a caller.

get_conditions() never raises: any provider failure or timeout is
caught and converted into the {"status": "unavailable"} shape from
api-contract.md, since an upstream outage is an expected condition,
not an exception for callers to handle.
"""

import concurrent.futures
import functools
import random
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote

import httpx

TIMEOUT_SECONDS = 3.0

# Per-request bound for the provider's own HTTP calls. Kept under
# TIMEOUT_SECONDS so an abandoned worker thread doesn't linger long.
HTTP_TIMEOUT_SECONDS = 2.5

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="conditions")


@dataclass
class ConditionsData:
    temperature_c: float
    condition: str
    map_url: str  # link to open the location in a map
    map_embed_url: str = ""  # iframe-embeddable map; empty when unavailable


class ConditionsProvider(Protocol):
    def fetch(self, location: str) -> ConditionsData: ...


class StubConditionsProvider:
    """Deterministic fake used until a real maps/weather API key exists.

    A real provider would call out to an actual maps/weather API here,
    using its own bounded request timeout, and would raise on any
    network/HTTP failure -- get_conditions() below is what catches that.
    """

    def fetch(self, location: str) -> ConditionsData:
        rng = random.Random(sum(ord(c) for c in location))
        return ConditionsData(
            temperature_c=round(rng.uniform(-5, 35), 1),
            condition=rng.choice(["Clear", "Partly cloudy", "Cloudy", "Rain", "Snow"]),
            map_url=f"https://www.openstreetmap.org/search?query={quote(location)}",
        )


# WMO weather interpretation codes -> short text, as returned by Open-Meteo.
_WMO_CONDITIONS = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy rain showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with hail",
}


def _osm_urls(lat: float, lon: float) -> tuple[str, str]:
    link = f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=11/{lat}/{lon}"
    west, south, east, north = (round(v, 5) for v in (lon - 0.1, lat - 0.06, lon + 0.1, lat + 0.06))
    embed = (
        "https://www.openstreetmap.org/export/embed.html"
        f"?bbox={west}%2C{south}%2C{east}%2C{north}&layer=mapnik&marker={lat}%2C{lon}"
    )
    return link, embed


def _pick_geocoding_result(results: list[dict], hint: str) -> dict:
    """Prefer a result whose country/region matches the text after the comma."""
    hint = hint.strip().lower()
    if hint:
        for r in results:
            names = (r.get("country"), r.get("admin1"), r.get("country_code"))
            if any(n and n.lower() == hint for n in names):
                return r
    return results[0]


@functools.lru_cache(maxsize=256)
def _geocode(location: str) -> tuple[float, float]:
    """Resolves "City, Country" to (lat, lon). Failures raise and are not cached."""
    name, _, hint = location.partition(",")
    # Try the full string first (the API often ranks "Kyoto, Japan" well),
    # then just the name.
    for query in (location, name):
        resp = httpx.get(
            GEOCODING_URL,
            params={"name": query.strip(), "count": 10, "language": "en", "format": "json"},
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        results = resp.json().get("results") or []
        if results:
            best = _pick_geocoding_result(results, hint)
            return best["latitude"], best["longitude"]
    raise LookupError(f"could not geocode {location!r}")


class OpenMeteoProvider:
    """Real conditions from Open-Meteo (no API key). Shows *current* conditions
    for the day's location. Raises on any network/HTTP/shape problem --
    get_conditions() turns that into {"status": "unavailable"}."""

    def fetch(self, location: str) -> ConditionsData:
        lat, lon = _geocode(location.strip())
        resp = httpx.get(
            FORECAST_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,weather_code",
                "timezone": "auto",
            },
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        current = resp.json()["current"]
        map_url, map_embed_url = _osm_urls(lat, lon)
        return ConditionsData(
            temperature_c=current["temperature_2m"],
            condition=_WMO_CONDITIONS.get(current["weather_code"], "Unknown"),
            map_url=map_url,
            map_embed_url=map_embed_url,
        )


def _default_provider() -> ConditionsProvider:
    return OpenMeteoProvider()


def get_conditions(location: str, provider: ConditionsProvider | None = None) -> dict:
    """Returns {"status": "ok", "data": {...}} or {"status": "unavailable"}.

    `provider` is only ever overridden in tests; production callers
    always get the default (Open-Meteo) provider.
    """
    provider = provider or _default_provider()
    try:
        future = _executor.submit(provider.fetch, location)
        data = future.result(timeout=TIMEOUT_SECONDS)
    except Exception:
        return {"status": "unavailable"}

    return {
        "status": "ok",
        "data": {
            "temperature_c": data.temperature_c,
            "condition": data.condition,
            "map_url": data.map_url,
            "map_embed_url": data.map_embed_url,
        },
    }
