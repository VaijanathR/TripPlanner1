import httpx
import pytest

import upstream

# The suite-wide offline fixture replaces upstream.get_json for every test; keep the
# real function from import time so this file can test it.
real_get_json = upstream.get_json


class Resp:
    def __init__(self, status=200, body=None, bad_json=False):
        self.status_code, self._body, self._bad = status, body if body is not None else {"ok": True}, bad_json

    def json(self):
        if self._bad:
            raise ValueError("not json")
        return self._body


@pytest.fixture()
def http(monkeypatch):
    """Scripted responses for httpx.get; records every call."""
    script, calls = [], []

    def fake_get(url, params=None, headers=None, timeout=None, follow_redirects=None):
        calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        item = script.pop(0) if len(script) > 1 else script[0]
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(upstream.httpx, "get", fake_get)
    monkeypatch.setattr(upstream, "RETRY_DELAY_SECONDS", 0)
    return script, calls


def test_a_good_response_is_returned_as_json(http):
    script, calls = http
    script.append(Resp(200, {"a": 1}))

    assert real_get_json("https://x/y", {"q": "z"}, timeout=5) == {"a": 1}
    assert calls[0]["params"] == {"q": "z"} and calls[0]["timeout"] == 5


def test_every_request_identifies_the_app_as_wikimedia_requires(http):
    script, calls = http
    script.append(Resp())

    real_get_json("https://x/y")

    assert "TripPlanner" in calls[0]["headers"]["User-Agent"]
    assert calls[0]["headers"]["User-Agent"] == upstream.USER_AGENT


def test_a_404_is_reported_as_not_found(http):
    http[0].append(Resp(404))

    with pytest.raises(upstream.UpstreamNotFound):
        real_get_json("https://x/y")


def test_a_429_is_reported_as_rate_limited_and_is_not_retried(http):
    script, calls = http
    script.append(Resp(429))

    with pytest.raises(upstream.UpstreamRateLimited):
        real_get_json("https://x/y")
    assert len(calls) == 1  # hammering a service that said "slow down" only makes it worse


def test_other_errors_are_upstream_errors_and_are_not_retried(http):
    script, calls = http
    script.append(Resp(500))

    with pytest.raises(upstream.UpstreamError):
        real_get_json("https://x/y")
    assert len(calls) == 1


@pytest.mark.parametrize("status", [502, 503, 504])
def test_a_gateway_error_is_retried_once_and_can_recover(http, status):
    script, calls = http
    script.extend([Resp(status), Resp(200, {"recovered": True})])

    assert real_get_json("https://x/y") == {"recovered": True}
    assert len(calls) == 2


def test_a_gateway_error_twice_is_given_up_on(http):
    script, calls = http
    script.append(Resp(502))

    with pytest.raises(upstream.UpstreamError):
        real_get_json("https://x/y")
    assert len(calls) == 2  # exactly one retry, not a loop


def test_a_network_failure_is_an_upstream_error(http):
    http[0].append(httpx.ConnectTimeout("slow"))

    with pytest.raises(upstream.UpstreamError):
        real_get_json("https://x/y")


def test_a_non_json_body_is_an_upstream_error(http):
    http[0].append(Resp(200, bad_json=True))

    with pytest.raises(upstream.UpstreamError):
        real_get_json("https://x/y")
