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
        "data": {"temperature_c": 20.0, "condition": "Clear", "map_url": "https://x/1"},
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
