"""Where the database lives: configurable, so production can keep it on storage that survives a deploy."""

import os
import pathlib
import sqlite3
import subprocess
import sys

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent


def run_python(code: str, env_extra: dict, cwd: pathlib.Path = BACKEND):
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
    env.update(env_extra)
    return subprocess.run([sys.executable, "-c", code], cwd=cwd, env=env, capture_output=True, text=True)


def test_the_default_database_is_a_local_file_so_development_and_tests_need_no_setup():
    result = run_python("import database; print(database.DATABASE_URL)", {})

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "sqlite:///./trip_planner.db"


def test_database_url_moves_the_database_and_creates_its_folder(tmp_path):
    target = tmp_path / "persistent" / "data" / "trip.db"  # neither folder exists yet

    result = run_python(
        "import database; print(database.engine.url.database)", {"DATABASE_URL": f"sqlite:///{target}"}
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == str(target)
    assert target.parent.is_dir()


def test_an_absolute_sqlite_url_with_four_slashes_works_like_the_one_used_on_azure(tmp_path):
    target = tmp_path / "home" / "data" / "trip_planner.db"

    result = run_python(
        "import database; print(database.engine.url.database)", {"DATABASE_URL": f"sqlite:////{str(target).lstrip('/')}"}
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == str(target)


def test_an_empty_database_url_falls_back_to_the_default():
    result = run_python("import database; print(database.DATABASE_URL)", {"DATABASE_URL": ""})

    assert result.stdout.strip() == "sqlite:///./trip_planner.db"


def test_migrations_run_against_the_configured_database_not_the_local_default(tmp_path):
    target = tmp_path / "nested" / "trip.db"
    local_default = BACKEND / "trip_planner.db"
    before = local_default.stat().st_mtime if local_default.exists() else None

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"), "upgrade", "head"],
        cwd=BACKEND,
        env={**{k: v for k, v in os.environ.items() if k != "DATABASE_URL"}, "DATABASE_URL": f"sqlite:///{target}"},
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    with sqlite3.connect(target) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"users", "trips", "days", "activities", "destination_guides"} <= tables
    after = local_default.stat().st_mtime if local_default.exists() else None
    assert after == before  # the local development database was not touched


def test_data_written_by_the_app_is_still_there_after_the_process_restarts(tmp_path):
    """The property production needs: a new process (as after a restart or deploy) sees old data."""
    target = tmp_path / "keep" / "trip.db"
    env = {"DATABASE_URL": f"sqlite:///{target}"}
    migrate = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"), "upgrade", "head"],
        cwd=BACKEND, env={**{k: v for k, v in os.environ.items() if k != "DATABASE_URL"}, **env}, capture_output=True, text=True,
    )
    assert migrate.returncode == 0, migrate.stderr
    write = (
        "import database, models\n"
        "db = database.SessionLocal(); u = models.User(email='keep@example.com'); db.add(u); db.commit()\n"
        "db.add(models.Trip(user_id=u.id, name='survives')); db.commit(); print('written')"
    )
    read = "import database, models\nprint([t.name for t in database.SessionLocal().query(models.Trip)])"

    first = run_python(write, env)
    second = run_python(read, env)  # a brand-new process

    assert first.returncode == 0, first.stderr
    assert second.stdout.strip() == "['survives']"


def test_foreign_keys_are_enforced_on_the_configured_database(tmp_path):
    target = tmp_path / "fk" / "trip.db"
    env = {"DATABASE_URL": f"sqlite:///{target}"}
    migrate = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"), "upgrade", "head"],
        cwd=BACKEND, env={**{k: v for k, v in os.environ.items() if k != "DATABASE_URL"}, **env}, capture_output=True, text=True,
    )
    assert migrate.returncode == 0, migrate.stderr

    result = run_python(
        "import database, models\n"
        "db = database.SessionLocal()\n"
        "db.add(models.Trip(user_id=999, name='orphan'))\n"
        "try:\n    db.commit(); print('accepted')\nexcept Exception as e:\n    print('rejected')",
        env,
    )

    assert result.stdout.strip() == "rejected"
