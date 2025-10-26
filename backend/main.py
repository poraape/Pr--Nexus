"""Entrypoint for the FastAPI backend application."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.endpoints import router as api_router
from backend.core.config import settings
from backend.database import Base, engine
import backend.database.models  # noqa: F401 - ensure models are registered

logger = logging.getLogger(__name__)

app = FastAPI(title="Nexus Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin] if settings.frontend_origin != "*" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


def _ensure_directories() -> None:
    for directory in settings.directories_to_ensure:
        directory.mkdir(parents=True, exist_ok=True)
        logger.info("Ensured persistence directory exists: %s", directory)


def _run_migrations() -> None:
    config_path = Path(__file__).resolve().parent / "alembic.ini"
    migrations_path = Path(__file__).resolve().parent / "alembic"
    alembic_cfg = Config(str(config_path))
    alembic_cfg.set_main_option("script_location", str(migrations_path))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.sqlalchemy_sync_url)
    command.upgrade(alembic_cfg, "head")
    logger.info("Database migrations applied successfully")


def _bootstrap_database() -> None:
    _ensure_directories()
    _run_migrations()
    Base.metadata.create_all(bind=engine)
    logger.info("Database schema ensured")


@app.on_event("startup")
async def ensure_database_schema() -> None:
    """Garantir que diretórios e tabelas existam ao subir o serviço."""

    await asyncio.to_thread(_bootstrap_database)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    """Simple healthcheck endpoint."""

    return {"status": "ok"}
