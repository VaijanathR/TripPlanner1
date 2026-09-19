import os
import tempfile

# Must be set before `main` is imported: it refuses to start without a secret.
os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-at-least-32-characters-long")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import weather
from database import Base, get_db
from main import app


@pytest.fixture()
def db_session_factory():
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    yield TestingSessionLocal

    engine.dispose()
    os.close(db_fd)
    os.remove(db_path)


@pytest.fixture()
def _db_override(db_session_factory):
    def override_get_db():
        db = db_session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()


def _logged_in_client(email: str):
    """A TestClient already carrying a bearer token for a freshly registered user."""
    with TestClient(app) as test_client:
        resp = test_client.post(
            "/api/auth/register", json={"email": email, "password": "correct-horse-battery"}
        )
        assert resp.status_code == 201, resp.text
        test_client.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"
        yield test_client


@pytest.fixture()
def anon_client(_db_override):
    """No credentials at all."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def client(_db_override):
    """Logged in as owner@example.com -- what most endpoint tests want."""
    yield from _logged_in_client("owner@example.com")


@pytest.fixture()
def other_client(_db_override):
    """Logged in as a second, unrelated user."""
    yield from _logged_in_client("other@example.com")


@pytest.fixture()
def trip(client):
    resp = client.post("/api/trips", json={"name": "Kyoto in Autumn"})
    return resp.json()


@pytest.fixture(autouse=True)
def offline_conditions_provider(monkeypatch):
    """Endpoint tests must never call the real Open-Meteo API."""
    monkeypatch.setattr(weather, "_default_provider", lambda: weather.StubConditionsProvider())
