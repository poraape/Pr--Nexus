"""Entrypoint for the FastAPI backend application."""
from __future__ import annotations

import asyncio
import logging
import os

os.environ["ANONYMIZED_TELEMETRY"] = "false"

logging.basicConfig(level=logging.INFO)
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.api.endpoints import router as api_router
from backend.core.config import settings
from backend.database import Base, engine
from backend.graph import create_graph
from backend.services.repositories import SQLAlchemyStatusRepository
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

project_root = Path(__file__).resolve().parent.parent
frontend_dist_dir = project_root / "frontend" / "dist"
fallback_dist_dir = project_root / "dist"

if frontend_dist_dir.exists():
    static_dir = frontend_dist_dir
elif fallback_dist_dir.exists():
    static_dir = fallback_dist_dir
else:
    static_dir = None

if static_dir is not None:
    logger.info("Serving frontend static files from %s", static_dir)
    app.mount(
        "/static",
        StaticFiles(directory=static_dir, html=True),
        name="frontend-static",
    )

    @app.get("/", include_in_schema=False)
    async def serve_root() -> FileResponse:
        index_path = static_dir / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="index.html not found")
        return FileResponse(index_path)
else:  # pragma: no cover - depends on deployment setup
    logger.warning(
        "Frontend build directory not found. Checked: %s and %s",
        frontend_dist_dir,
        fallback_dist_dir,
    )


def ensure_runtime_directories() -> None:
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
    ensure_runtime_directories()
    _run_migrations()
    Base.metadata.create_all(bind=engine)
    logger.info("Database schema ensured")


@app.on_event("startup")
async def ensure_database_schema() -> None:
    """Inicializa recursos necessários ao subir o serviço."""

    ensure_runtime_directories()
    Base.metadata.create_all(bind=engine)
    graph = create_graph(status_repository=SQLAlchemyStatusRepository())
    app.state.agent_graph = graph

    # Reutilizar o mesmo grafo na instância global do worker inline
    from backend.api import endpoints as api_endpoints  # import local para evitar ciclo

    api_endpoints._worker.graph = graph


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    """Simple healthcheck endpoint."""

    return {"status": "ok"}


if static_dir is not None:
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        index_path = static_dir / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="Resource not found")
        return FileResponse(index_path)
