"""One place for calls to third-party APIs (Wikipedia, Wikidata, geocoding).

Wikimedia asks API clients to identify themselves and rate-limits (HTTP 429)
clients that don't or that hammer them, so every call goes through here with a
descriptive User-Agent, a timeout, and typed errors the callers can degrade on.
Tests replace `get_json` so nothing ever touches the network.
"""

import threading
import time

import httpx

USER_AGENT = "TripPlannerCourseProject/1.0 (student project; https://github.com/VaijanathR/TripPlanner1)"

# A gateway error from Wikidata's proxy is usually momentary; try once more.
RETRY_STATUSES = {502, 503, 504}
RETRY_DELAY_SECONDS = 3.0

# Wikimedia asks for modest concurrency; two in flight is plenty for us.
_slots = threading.BoundedSemaphore(2)


class UpstreamError(Exception):
    """Any failure talking to an upstream API (network, HTTP error, bad body)."""


class UpstreamNetworkError(UpstreamError):
    """The request never got an HTTP answer (timeout, connection reset...). Worth one quick retry."""


class UpstreamNotFound(UpstreamError):
    """The upstream answered 404: the thing asked for doesn't exist."""


class UpstreamRateLimited(UpstreamError):
    """The upstream answered 429."""


def _fetch(url: str, params: dict | None, timeout: float) -> httpx.Response:
    try:
        with _slots:
            return httpx.get(
                url,
                params=params,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                timeout=timeout,
                follow_redirects=True,
            )
    except httpx.HTTPError as exc:
        raise UpstreamNetworkError(str(exc)) from exc


def get_json(url: str, params: dict | None = None, timeout: float = 8.0):
    try:
        resp = _fetch(url, params, timeout)
    except UpstreamNetworkError:
        resp = _fetch(url, params, timeout)  # a dropped connection is usually momentary
    if resp.status_code in RETRY_STATUSES:
        time.sleep(RETRY_DELAY_SECONDS)
        resp = _fetch(url, params, timeout)
    if resp.status_code == 404:
        raise UpstreamNotFound(url)
    if resp.status_code == 429:
        raise UpstreamRateLimited(url)
    if resp.status_code >= 400:
        raise UpstreamError(f"HTTP {resp.status_code} from {url}")
    try:
        return resp.json()
    except ValueError as exc:
        raise UpstreamError(f"non-JSON response from {url}") from exc
