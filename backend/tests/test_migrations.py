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


def test_trips_get_destination_columns_and_a_guide_cache_table(db_path):
    command.upgrade(_config(db_path), "head")

    trip_columns = {row[1] for row in _rows(db_path, "PRAGMA table_info(trips)")}
    assert {"geoname_id", "city", "state", "country", "country_code", "latitude", "longitude"} <= trip_columns
    guide_columns = {row[1] for row in _rows(db_path, "PRAGMA table_info(destination_guides)")}
    assert {"geoname_id", "status", "payload", "updated_at"} <= guide_columns


def test_existing_trips_survive_the_destination_migration_with_no_destination(db_path):
    cfg = _config(db_path)
    command.upgrade(cfg, "c41a7d2e9f10")
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO users (email) VALUES ('a@example.com')")
        conn.execute("INSERT INTO trips (user_id, name) VALUES (1, 'Old trip')")

    command.upgrade(cfg, "head")

    assert _rows(db_path, "SELECT name, geoname_id, city FROM trips") == [("Old trip", None, None)]


def test_a_second_guide_row_for_the_same_place_is_refused(db_path):
    command.upgrade(_config(db_path), "head")
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO destination_guides (geoname_id, status) VALUES (5, 'ready')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO destination_guides (geoname_id, status) VALUES (5, 'ready')")


def test_running_migrations_in_process_does_not_silence_the_applications_loggers(db_path):
    import logging

    app_logger = logging.getLogger("trip_planner.ratelimit")
    app_logger.disabled = False

    command.upgrade(_config(db_path), "head")

    assert app_logger.disabled is False


def test_the_rate_limiting_table_has_its_columns_and_indexes(db_path):
    command.upgrade(_config(db_path), "head")

    columns = {row[1]: row for row in _rows(db_path, "PRAGMA table_info(auth_attempts)")}
    assert set(columns) == {"id", "kind", "email_hash", "address_hash", "created_at"}
    assert [columns[c][3] for c in ("kind", "address_hash", "created_at")] == [1, 1, 1]  # NOT NULL
    assert columns["email_hash"][3] == 0  # sign-up and Google attempts have no email
    indexes = {row[1] for row in _rows(db_path, "PRAGMA index_list(auth_attempts)")}
    assert {"ix_auth_attempts_kind_address_created", "ix_auth_attempts_kind_email_address"} <= indexes


def test_existing_data_survives_the_rate_limiting_migration(db_path):
    cfg = _config(db_path)
    command.upgrade(cfg, "d52b8e3f1a20")
    with sqlite3.connect(db_path) as conn:
        conn.execute("INSERT INTO users (email) VALUES ('a@example.com')")
        conn.execute("INSERT INTO trips (user_id, name) VALUES (1, 'Kept')")

    command.upgrade(cfg, "head")

    assert _rows(db_path, "SELECT name FROM trips") == [("Kept",)]
    assert _rows(db_path, "SELECT COUNT(*) FROM auth_attempts") == [(0,)]


def test_the_rate_limiting_migration_downgrades_cleanly(db_path):
    cfg = _config(db_path)
    command.upgrade(cfg, "head")

    command.downgrade(cfg, "d52b8e3f1a20")

    tables = {r[0] for r in _rows(db_path, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "auth_attempts" not in tables and "trips" in tables


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
