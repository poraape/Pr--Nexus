"""Entrypoint for the FastAPI backend application."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.endpoints import router as api_router
from backend.core.config import settings
from backend.database import Base, engine
import backend.database.models  # noqa: F401 - ensure models are registered

app = FastAPI(title="Nexus Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin] if settings.frontend_origin != "*" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.on_event("startup")
async def ensure_database_schema() -> None:
    """Garantir que as tabelas existam ao subir o serviço."""

    Base.metadata.create_all(bind=engine)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    """Simple healthcheck endpoint."""

    return {"status": "ok"}
