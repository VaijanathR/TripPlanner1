import os
import pathlib

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Where the data lives. The default (a file next to the app) is right for local
# development and tests. In production it MUST point at storage that survives a
# deploy: on Azure App Service that is /home, e.g.
#   DATABASE_URL=sqlite:////home/data/trip_planner.db
# The app itself runs from a per-deployment temporary folder, so a database
# left there is wiped by every deploy.
DEFAULT_DATABASE_URL = "sqlite:///./trip_planner.db"
DATABASE_URL = os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL

_SQLITE_PREFIX = "sqlite:///"
IS_SQLITE = DATABASE_URL.startswith("sqlite")


def ensure_sqlite_directory(url: str) -> None:
    """Creates the folder for a SQLite file URL (a fresh persistent volume has none)."""
    if url.startswith(_SQLITE_PREFIX):
        path = url[len(_SQLITE_PREFIX):].split("?", 1)[0]
        if path and path != ":memory:":
            pathlib.Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


ensure_sqlite_directory(DATABASE_URL)

# check_same_thread: the guide is built in a background thread. timeout: wait for a
# write lock instead of failing at once (the file may sit on a network drive).
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30} if IS_SQLITE else {},
)


if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
