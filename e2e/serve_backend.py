"""Start the real backend for the end-to-end tests.

Everything is the production code except two things, exactly as in the backend's
own tests: the outside world (geocoder, Wikipedia, Wikidata) is answered from
canned data, and the weather comes from the offline stub. A fresh throwaway
database is migrated on every start, so runs never affect each other.

    python e2e/serve_backend.py        (port 8000; needs the backend's requirements)
"""

import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
PORT = int(os.environ.get("E2E_API_PORT", "8000"))
APP_ORIGIN = os.environ.get("E2E_APP_ORIGIN", "http://127.0.0.1:4173")

DB_FILE = pathlib.Path(tempfile.gettempdir()) / "trip-planner-e2e.db"
DB_FILE.unlink(missing_ok=True)

os.environ["JWT_SECRET"] = "e2e-only-secret-that-is-at-least-32-characters-long"
os.environ["DATABASE_URL"] = f"sqlite:///{DB_FILE}"
os.environ["CORS_ORIGINS"] = APP_ORIGIN

subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, check=True)

sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import uvicorn  # noqa: E402

import geocoding  # noqa: E402
import guide  # noqa: E402
import upstream  # noqa: E402
import weather  # noqa: E402
from main import app  # noqa: E402
from tests.fakes import FakeUpstream, geocode_result, sparql_response, sparql_row, summary  # noqa: E402

KYOTO = geocode_result(1857910, "Kyoto", "Kyoto", "Japan", "JP", 35.02107, 135.75385, 1_463_723)

world = FakeUpstream()
world.on(geocoding.SEARCH_URL, lambda url, params: {"results": [KYOTO] if params["name"] == "Kyoto" else []})
world.on(
    geocoding.GET_URL,
    lambda url, params: KYOTO if int(params["id"]) == KYOTO["id"] else (_ for _ in ()).throw(upstream.UpstreamNotFound("no such id")),
)
world.on(guide.WIKI_SUMMARY, upstream.UpstreamNotFound("no such page"))
world.on(guide.WIKI_SUMMARY + "Kyoto%2C_Kyoto", summary("Kyoto"), exact=True)
world.on(guide.WIKI_SUMMARY + "Kyoto_Prefecture", summary("Kyoto Prefecture", "Prefecture of Japan", lat=35.2, lon=135.4), exact=True)
world.on(guide.WIKI_SUMMARY + "Japan", summary("Japan", "Country in East Asia"), exact=True)
world.on(
    guide.WIKIDATA_SPARQL,
    [
        sparql_response(sparql_row("Q1", "Kiyomizu-dera", 77, 2.0, "Q5393308", "Buddhist temple", image="K.jpg")),
        sparql_response(sparql_row("Q3", "Mount Hiei", 30, 20.0, "Q8502", "mountain")),
    ],
)
upstream.get_json = world  # the guide builds in its normal background thread
weather._default_provider = lambda: weather.StubConditionsProvider()

uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
