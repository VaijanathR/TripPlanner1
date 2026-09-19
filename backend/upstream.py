"""One place for calls to third-party APIs (Wikipedia, Wikidata, geocoding).

Wikimedia asks API clients to identify themselves and rate-limits (HTTP 429)
clients that don't or that hammer them, so every call goes through here with a
descriptive User-Agent, a timeout, and typed errors the callers can degrade on.
Tests replace `get_json` so nothing ever touches the network.
"""

import threading

import httpx

USER_AGENT = "TripPlannerCourseProject/1.0 (student project; https://github.com/VaijanathR/TripPlanner1)"

# Wikimedia asks for modest concurrency; two in flight is plenty for us.
_slots = threading.BoundedSemaphore(2)


class UpstreamError(Exception):
    """Any failure talking to an upstream API (network, HTTP error, bad body)."""


class UpstreamNotFound(UpstreamError):
    """The upstream answered 404: the thing asked for doesn't exist."""


class UpstreamRateLimited(UpstreamError):
    """The upstream answered 429."""


def get_json(url: str, params: dict | None = None, timeout: float = 8.0):
    try:
        with _slots:
            resp = httpx.get(
                url,
                params=params,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                timeout=timeout,
                follow_redirects=True,
            )
    except httpx.HTTPError as exc:
        raise UpstreamError(str(exc)) from exc
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
