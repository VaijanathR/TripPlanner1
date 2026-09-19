"""The users/ownership migration, run against real SQLite files."""

import pathlib
import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BACKEND = pathlib.Path(__file__).resolve().parent.parent
LEGACY_EMAIL = "legacy-owner@invalid.local"


def _config(db_path) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return cfg


@pytest.fixture()
def db_path(tmp_path):
    return tmp_path / "migration.db"


def _rows(db_path, sql):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(sql).fetchall()


def test_upgrading_an_empty_database_creates_no_legacy_user(db_path):
    command.upgrade(_config(db_path), "head")

    assert _rows(db_path, "SELECT COUNT(*) FROM users") == [(0,)]
    columns = {row[1]: row for row in _rows(db_path, "PRAGMA table_info(trips)")}
    assert columns["user_id"][3] == 1  # NOT NULL


def test_existing_trips_are_kept_and_given_to_a_login_less_legacy_owner(db_path):
    cfg = _config(db_path)
    command.upgrade(cfg, "b6c22ddcec02")  # the schema before accounts existed
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO trips (name) VALUES ('Old trip A'), ('Old trip B')")

    command.upgrade(cfg, "head")

    owners = _rows(db_path, "SELECT t.name, u.email, u.password_hash, u.google_sub FROM trips t JOIN users u ON u.id = t.user_id ORDER BY t.id")
    assert owners == [("Old trip A", LEGACY_EMAIL, None, None), ("Old trip B", LEGACY_EMAIL, None, None)]


def test_the_migration_can_be_downgraded_and_upgraded_again(db_path):
    cfg = _config(db_path)
    command.upgrade(cfg, "head")

    command.downgrade(cfg, "b6c22ddcec02")
    assert "user_id" not in {row[1] for row in _rows(db_path, "PRAGMA table_info(trips)")}
    command.upgrade(cfg, "head")

    assert "user_id" in {row[1] for row in _rows(db_path, "PRAGMA table_info(trips)")}


def test_deleting_a_user_deletes_their_trips(db_path):
    command.upgrade(_config(db_path), "head")
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("INSERT INTO users (email) VALUES ('a@example.com')")
        conn.execute("INSERT INTO trips (user_id, name) VALUES (1, 'T')")
        conn.execute("DELETE FROM users WHERE id = 1")

    assert _rows(db_path, "SELECT COUNT(*) FROM trips") == [(0,)]
