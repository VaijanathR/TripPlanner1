import time

import weather


class OkProvider:
    def fetch(self, location):
        return weather.ConditionsData(temperature_c=20.0, condition="Clear", map_url="https://x/1")


class FailingProvider:
    def fetch(self, location):
        raise ConnectionError("upstream is down")


class HangingProvider:
    def fetch(self, location):
        time.sleep(weather.TIMEOUT_SECONDS + 1)
        return weather.ConditionsData(temperature_c=0, condition="unreachable", map_url="")


def test_get_conditions_ok():
    result = weather.get_conditions("Kyoto, Japan", provider=OkProvider())
    assert result == {
        "status": "ok",
        "data": {
            "temperature_c": 20.0,
            "condition": "Clear",
            "map_url": "https://x/1",
            "map_embed_url": "",
        },
    }


def test_get_conditions_unavailable_on_provider_error():
    result = weather.get_conditions("Kyoto, Japan", provider=FailingProvider())
    assert result == {"status": "unavailable"}


def test_get_conditions_unavailable_on_timeout(monkeypatch):
    monkeypatch.setattr(weather, "TIMEOUT_SECONDS", 0.2)
    result = weather.get_conditions("Kyoto, Japan", provider=HangingProvider())
    assert result == {"status": "unavailable"}


def test_get_conditions_never_raises_for_arbitrary_exceptions():
    class WeirdProvider:
        def fetch(self, location):
            raise RuntimeError("something unexpected")

    # Should not raise -- this is the core contract of the module.
    result = weather.get_conditions("Anywhere", provider=WeirdProvider())
    assert result == {"status": "unavailable"}


def test_stub_provider_is_deterministic_per_location():
    a = weather.StubConditionsProvider().fetch("Kyoto, Japan")
    b = weather.StubConditionsProvider().fetch("Kyoto, Japan")
    assert a == b


# ---------------------------------------------------------------------------
# OpenMeteoProvider -- httpx.get is faked, so these never touch the network.
# ---------------------------------------------------------------------------

import httpx
import pytest


class FakeResponse:
    def __init__(self, body, status=200):
        self._body, self.status_code = body, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad", request=None, response=None)

    def json(self):
        return self._body


KYOTO = {"name": "Kyoto", "admin1": "Kyoto", "country": "Japan", "country_code": "JP",
         "latitude": 35.02, "longitude": 135.75}
FORECAST = {"current": {"temperature_2m": 24.4, "weather_code": 2}}


@pytest.fixture()
def fake_http(monkeypatch):
    """Records calls to httpx.get; `routes` maps URL -> list of responses/exceptions."""
    weather._geocode.cache_clear()
    calls = []
    routes = {weather.GEOCODING_URL: [FakeResponse({"results": [KYOTO]})],
              weather.FORECAST_URL: [FakeResponse(FORECAST)]}

    def fake_get(url, params=None, timeout=None):
        calls.append({"url": url, "params": params, "timeout": timeout})
        queue = routes[url]
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(weather.httpx, "get", fake_get)
    yield calls, routes
    weather._geocode.cache_clear()


def test_open_meteo_maps_response_to_conditions(fake_http):
    calls, _ = fake_http

    data = weather.OpenMeteoProvider().fetch("Kyoto, Japan")

    assert data.temperature_c == 24.4
    assert data.condition == "Partly cloudy"  # WMO code 2
    assert "mlat=35.02" in data.map_url and "mlon=135.75" in data.map_url
    assert data.map_embed_url.startswith("https://www.openstreetmap.org/export/embed.html?bbox=")
    assert "marker=35.02%2C135.75" in data.map_embed_url
    forecast_call = calls[-1]
    assert forecast_call["params"]["latitude"] == 35.02
    assert forecast_call["params"]["longitude"] == 135.75


def test_open_meteo_bounds_every_http_call(fake_http):
    calls, _ = fake_http

    weather.OpenMeteoProvider().fetch("Kyoto, Japan")

    assert len(calls) == 2
    assert all(c["timeout"] == weather.HTTP_TIMEOUT_SECONDS for c in calls)


def test_open_meteo_unknown_weather_code_still_returns_a_condition(fake_http):
    _, routes = fake_http
    routes[weather.FORECAST_URL] = [FakeResponse({"current": {"temperature_2m": 1.0, "weather_code": 12345}})]

    assert weather.OpenMeteoProvider().fetch("Kyoto, Japan").condition == "Unknown"


def test_geocoding_prefers_the_result_matching_the_hint(fake_http):
    _, routes = fake_http
    paris_fr = {"name": "Paris", "admin1": "Île-de-France", "country": "France", "latitude": 48.85, "longitude": 2.35}
    paris_tx = {"name": "Paris", "admin1": "Texas", "country": "United States", "latitude": 33.66, "longitude": -95.55}
    routes[weather.GEOCODING_URL] = [FakeResponse({"results": [paris_fr, paris_tx]})]

    data = weather.OpenMeteoProvider().fetch("Paris, Texas")

    assert "mlat=33.66" in data.map_url


def test_geocoding_falls_back_to_the_name_alone_when_the_full_string_finds_nothing(fake_http):
    calls, routes = fake_http
    routes[weather.GEOCODING_URL] = [FakeResponse({}), FakeResponse({"results": [KYOTO]})]

    data = weather.OpenMeteoProvider().fetch("Kyoto, Nowhereland")

    assert "mlat=35.02" in data.map_url
    geocode_queries = [c["params"]["name"] for c in calls if c["url"] == weather.GEOCODING_URL]
    assert geocode_queries == ["Kyoto, Nowhereland", "Kyoto"]


def test_unknown_location_makes_conditions_unavailable_not_an_error(fake_http):
    _, routes = fake_http
    routes[weather.GEOCODING_URL] = [FakeResponse({})]

    assert weather.get_conditions("Zzzzzz", provider=weather.OpenMeteoProvider()) == {"status": "unavailable"}


@pytest.mark.parametrize("url_key", ["GEOCODING_URL", "FORECAST_URL"])
@pytest.mark.parametrize("failure", [FakeResponse({}, status=503), httpx.ConnectTimeout("slow")])
def test_upstream_failure_makes_conditions_unavailable(fake_http, url_key, failure):
    _, routes = fake_http
    routes[getattr(weather, url_key)] = [failure]

    assert weather.get_conditions("Kyoto, Japan", provider=weather.OpenMeteoProvider()) == {"status": "unavailable"}


def test_malformed_forecast_makes_conditions_unavailable(fake_http):
    _, routes = fake_http
    routes[weather.FORECAST_URL] = [FakeResponse({"unexpected": True})]

    assert weather.get_conditions("Kyoto, Japan", provider=weather.OpenMeteoProvider()) == {"status": "unavailable"}


def test_geocoding_is_cached_per_location(fake_http):
    calls, _ = fake_http

    provider = weather.OpenMeteoProvider()
    provider.fetch("Kyoto, Japan")
    provider.fetch("Kyoto, Japan")

    assert sum(c["url"] == weather.GEOCODING_URL for c in calls) == 1
    assert sum(c["url"] == weather.FORECAST_URL for c in calls) == 2  # weather is always fresh


def test_a_failed_geocode_is_not_cached(fake_http):
    calls, routes = fake_http
    routes[weather.GEOCODING_URL] = [httpx.ConnectTimeout("blip"), FakeResponse({"results": [KYOTO]})]
    provider = weather.OpenMeteoProvider()

    with pytest.raises(httpx.ConnectTimeout):
        provider.fetch("Kyoto, Japan")
    assert provider.fetch("Kyoto, Japan").temperature_c == 24.4


def test_production_default_provider_is_the_real_one_not_the_stub(monkeypatch):
    monkeypatch.undo()  # drop the suite-wide offline override from conftest

    assert isinstance(weather._default_provider(), weather.OpenMeteoProvider)
