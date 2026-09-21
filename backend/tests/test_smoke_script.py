"""The post-deploy smoke test (scripts/smoke_test.py; acceptance matrix N7).

Each check is proved twice: it passes against a healthy fake deployment, and it
fails when that one thing is broken. The fake backend and frontend are local
servers, so nothing here touches the network beyond 127.0.0.1."""

import importlib.util
import pathlib
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "smoke_test.py"
spec = importlib.util.spec_from_file_location("smoke_test", SCRIPT)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

HTML = b'<html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>'


@contextmanager
def serve(handler_for):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()


def make_backend(*, health=(200,), trips=401, cors="echo"):
    """`health` is the sequence of statuses to answer /health with (last repeats)."""
    calls = {"health": 0}

    class Backend(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, status, headers=None, body=b"{}"):
            self.send_response(status)
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                status = health[min(calls["health"], len(health) - 1)]
                calls["health"] += 1
                self._send(status)
            elif self.path == "/api/trips":
                self._send(trips)
            else:
                self._send(404)

        def do_OPTIONS(self):
            origin = self.headers.get("Origin")
            if cors == "echo":
                self._send(200, {"Access-Control-Allow-Origin": origin})
            elif cors == "other":
                self._send(200, {"Access-Control-Allow-Origin": "https://somewhere-else.example"})
            else:  # "none"
                self._send(200)

    return Backend, calls


def make_frontend(backend_url, *, home=200, login=200, bundle=None):
    if bundle is None:
        bundle = f'const API="{backend_url}";'.encode()

    class Frontend(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path == "/":
                status, body = home, HTML
            elif self.path == "/login":
                status, body = login, HTML
            elif self.path == "/assets/app.js":
                status, body = 200, bundle
            else:
                status, body = 404, b"not found"
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Frontend


@pytest.fixture(autouse=True)
def quick_retries(monkeypatch):
    monkeypatch.setattr(smoke, "HEALTH_RETRY_EVERY", 0.05)


def run_against(*, backend=None, frontend=None, wait=1):
    """Run the real checks against fake servers; returns {check name: (ok, detail)}."""
    backend_handler, _ = make_backend(**(backend or {}))
    with serve(backend_handler) as backend_url:
        with serve(make_frontend(backend_url, **(frontend or {}))) as frontend_url:
            return {name: (ok, detail) for name, ok, detail in smoke.run(backend_url, frontend_url, wait)}


def failed(results):
    return {name for name, (ok, _) in results.items() if not ok}


def test_a_healthy_deployment_passes_every_check():
    results = run_against()

    assert failed(results) == set()
    assert len(results) == 6


def test_the_backend_is_retried_while_it_wakes_up_and_then_passes():
    results = run_against(backend={"health": (503, 503, 200)}, wait=5)

    assert results["backend /health"][0] is True


def test_a_backend_that_never_becomes_healthy_fails_the_health_check():
    results = run_against(backend={"health": (500,)}, wait=0.3)

    assert failed(results) == {"backend /health"}
    assert "HTTP 500" in results["backend /health"][1]


def test_an_unreachable_backend_fails_without_crashing_the_run():
    with serve(make_frontend("http://127.0.0.1:9")) as frontend_url:
        results = {name: ok for name, ok, _ in smoke.run("http://127.0.0.1:9", frontend_url, wait=0.2)}

    assert results["backend /health"] is False
    assert results["login required"] is False
    assert results["frontend loads"] is True  # one dead part does not hide the rest


def test_an_open_api_fails_the_login_required_check():
    results = run_against(backend={"trips": 200})

    assert failed(results) == {"login required"}


def test_a_backend_that_does_not_allow_the_frontend_origin_fails_the_cors_check():
    for cors in ("none", "other"):
        results = run_against(backend={"cors": cors})

        assert failed(results) == {"CORS allows the frontend"}, cors


def test_a_frontend_that_does_not_load_fails():
    results = run_against(frontend={"home": 500})

    assert "frontend loads" in failed(results)


def test_a_missing_deep_link_rewrite_fails_the_deep_link_check():
    results = run_against(frontend={"login": 404})

    assert failed(results) == {"deep link served"}


def test_a_bundle_without_the_backend_address_fails():
    results = run_against(frontend={"bundle": b'const API="http://localhost:8000";'})

    assert failed(results) == {"backend address built in"}


def test_a_bundle_with_the_sensitive_placeholder_fails():
    backend_handler, _ = make_backend()
    with serve(backend_handler) as backend_url:
        bundle = f'const API="[SENSITIVE]"; const other="{backend_url}";'.encode()
        with serve(make_frontend(backend_url, bundle=bundle)) as frontend_url:
            results = {n: (ok, d) for n, ok, d in smoke.run(backend_url, frontend_url, 1)}

    assert failed(results) == {"backend address built in"}
    assert "[SENSITIVE]" in results["backend address built in"][1]


def test_the_exit_code_and_report_reflect_the_result(capsys):
    backend_handler, _ = make_backend()
    with serve(backend_handler) as backend_url:
        with serve(make_frontend(backend_url)) as frontend_url:
            assert smoke.main([backend_url, frontend_url, "--wait", "1"]) == 0
            assert "6/6 checks passed" in capsys.readouterr().out
        with serve(make_frontend(backend_url, login=404)) as frontend_url:
            assert smoke.main([backend_url, frontend_url, "--wait", "1"]) == 1
            assert "FAIL  deep link served" in capsys.readouterr().out
