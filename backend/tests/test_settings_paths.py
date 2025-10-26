"""Tests for settings path resolution and directory handling."""
from __future__ import annotations

from pathlib import Path

from backend.core.config import Settings


def test_runtime_dir_overrides(monkeypatch, tmp_path) -> None:
    runtime_dir = tmp_path / "runtime"
    db_path = runtime_dir / "nexus.db"

    monkeypatch.setenv("SPACE_RUNTIME_DIR", str(runtime_dir))
    monkeypatch.setenv("POSTGRES_DSN", f"sqlite+aiosqlite:///{db_path}")
    # Ensure defaults are used for storage paths so the runtime dir override applies
    monkeypatch.delenv("STORAGE_PATH", raising=False)
    monkeypatch.delenv("CHROMA_PERSIST_DIRECTORY", raising=False)

    settings = Settings()

    expected_uploads = runtime_dir / "uploads"
    expected_chroma = runtime_dir / "chroma"

    assert settings.storage_path == expected_uploads.resolve()
    assert settings.chroma_persist_directory == expected_chroma.resolve()
    assert settings.sqlalchemy_sync_url.startswith("sqlite+pysqlite")
    assert settings.database_path == db_path.resolve()

    directories = set(settings.directories_to_ensure)
    assert expected_uploads.resolve() in directories
    assert expected_chroma.resolve() in directories
    assert runtime_dir.resolve() in {path.resolve() for path in directories}


def test_sqlalchemy_sync_url_passthrough(monkeypatch) -> None:
    postgres_url = "postgresql+psycopg://user:pass@db:5432/nexus"
    monkeypatch.setenv("POSTGRES_DSN", postgres_url)

    settings = Settings()

    from sqlalchemy.engine import make_url

    parsed = make_url(settings.sqlalchemy_sync_url)
    original = make_url(postgres_url)

    assert parsed.drivername == original.drivername
    assert parsed.username == original.username
    assert parsed.host == original.host
    assert parsed.database == original.database
