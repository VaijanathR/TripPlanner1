#!/usr/bin/env python3
"""Post-deploy smoke test: is the deployed app up and wired together?

    python scripts/smoke_test.py BACKEND_URL FRONTEND_URL [--wait SECONDS]

Read-only and account-free: plain GETs and one CORS preflight, nothing is created.
Exits 0 when every check passes, 1 otherwise. Stdlib only, so CI needs no install.

It proves the app is reachable and configured, NOT that the newest version is the
one answering (/health carries no version), and a restarting Azure F1 app can keep
serving the old process for a few minutes.
"""

import argparse
import re
import sys
import time
import urllib.error
import urllib.request

HEALTH_RETRY_EVERY = 10  # seconds between /health attempts while the backend wakes up


def fetch(url, method="GET", headers=None, timeout=30):
    """(status, headers, body) -- HTTP errors are returned, not raised."""
    request = urllib.request.Request(url, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def check_health(backend, wait):
    """The backend answers 200 on /health; retried for `wait` seconds (cold start)."""
    deadline = time.monotonic() + wait
    last = "no answer"
    while True:
        try:
            status, _, _ = fetch(f"{backend}/health")
            if status == 200:
                return True, "200"
            last = f"HTTP {status}"
        except OSError as error:  # refused, timed out, DNS, TLS ...
            last = f"{type(error).__name__}: {error}"
        if time.monotonic() + HEALTH_RETRY_EVERY > deadline:
            return False, f"still failing after {wait}s ({last})"
        time.sleep(HEALTH_RETRY_EVERY)


def check_login_required(backend):
    """A trip request with no login is refused with 401 (the auth layer is loaded)."""
    status, _, _ = fetch(f"{backend}/api/trips")
    return status == 401, f"HTTP {status}, expected 401"


def check_cors(backend, frontend):
    """The backend allows the frontend's origin (browser preflight)."""
    origin = frontend.rstrip("/")
    status, headers, _ = fetch(
        f"{backend}/api/auth/login",
        method="OPTIONS",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )
    allowed = headers.get("Access-Control-Allow-Origin")
    return status == 200 and allowed == origin, f"HTTP {status}, allow-origin {allowed!r}, expected {origin!r}"


def check_frontend_loads(frontend):
    status, _, body = fetch(frontend)
    return status == 200 and b'id="root"' in body, f"HTTP {status}"


def check_deep_link(frontend):
    """A client-side route (the SPA rewrite) is served, not a 404."""
    status, _, body = fetch(f"{frontend.rstrip('/')}/login")
    return status == 200 and b'id="root"' in body, f"HTTP {status}"


def check_backend_address_built_in(backend, frontend):
    """The deployed bundle contains the backend address and not the literal
    "[SENSITIVE]" that `vercel pull` writes for a sensitive variable."""
    _, _, html = fetch(frontend)
    scripts = re.findall(rb'<script[^>]+src="([^"]+)"', html)
    if not scripts:
        return False, "no script tags in the frontend HTML"
    bundle = b""
    for src in scripts:
        url = urllib.request.urljoin(frontend.rstrip("/") + "/", src.decode())
        status, _, body = fetch(url)
        if status != 200:
            return False, f"script {src.decode()} answered HTTP {status}"
        bundle += body
    if b"[SENSITIVE]" in bundle:
        return False, "bundle contains the literal text [SENSITIVE]"
    if backend.rstrip("/").encode() not in bundle:
        return False, f"bundle does not contain {backend.rstrip('/')}"
    return True, "backend address found in the bundle"


def run(backend, frontend, wait=300):
    """Run every check; returns a list of (name, ok, detail). A check that raises
    counts as a failure of that check only."""
    backend, frontend = backend.rstrip("/"), frontend.rstrip("/")
    checks = [
        ("backend /health", lambda: check_health(backend, wait)),
        ("login required", lambda: check_login_required(backend)),
        ("CORS allows the frontend", lambda: check_cors(backend, frontend)),
        ("frontend loads", lambda: check_frontend_loads(frontend)),
        ("deep link served", lambda: check_deep_link(frontend)),
        ("backend address built in", lambda: check_backend_address_built_in(backend, frontend)),
    ]
    results = []
    for name, check in checks:
        try:
            ok, detail = check()
        except Exception as error:  # noqa: BLE001 -- report, don't crash the run
            ok, detail = False, f"{type(error).__name__}: {error}"
        results.append((name, ok, detail))
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("backend")
    parser.add_argument("frontend")
    parser.add_argument("--wait", type=int, default=300, help="seconds to keep retrying /health")
    args = parser.parse_args(argv)
    results = run(args.backend, args.frontend, args.wait)
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
