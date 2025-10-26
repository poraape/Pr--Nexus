"""Entrypoint for the FastAPI backend application."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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
        "/",
        StaticFiles(directory=static_dir, html=True),
        name="frontend",
    )
else:  # pragma: no cover - depends on deployment setup
    logger.warning(
        "Frontend build directory not found. Checked: %s and %s",
        frontend_dist_dir,
        fallback_dist_dir,
    )


@app.on_event("startup")
async def ensure_database_schema() -> None:
    """Garantir que as tabelas existam ao subir o serviço."""

    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:  # pragma: no cover - depends on database availability
        logger.warning("Skipping database schema creation: %s", exc)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    """Simple healthcheck endpoint."""

    return {"status": "ok"}
