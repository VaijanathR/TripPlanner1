"""Maps/weather upstream integration.

Only backend/routers/conditions.py may import this module (per
backend-spec.md: the frontend never calls the upstream API directly,
and only the backend does; this module is that one call site). Any
future real API key is read here from server-side config only, never
returned to a caller.

get_conditions() never raises: any provider failure or timeout is
caught and converted into the {"status": "unavailable"} shape from
api-contract.md, since an upstream outage is an expected condition,
not an exception for callers to handle.
"""

import concurrent.futures
import random
from dataclasses import dataclass
from typing import Protocol

TIMEOUT_SECONDS = 3.0

_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="conditions")


@dataclass
class ConditionsData:
    temperature_c: float
    condition: str
    map_url: str


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
            map_url=f"https://maps.example.com/static?location={location}",
        )


def _default_provider() -> ConditionsProvider:
    return StubConditionsProvider()


def get_conditions(location: str, provider: ConditionsProvider | None = None) -> dict:
    """Returns {"status": "ok", "data": {...}} or {"status": "unavailable"}.

    `provider` is only ever overridden in tests; production callers
    always get the default (currently stub) provider.
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
        },
    }
