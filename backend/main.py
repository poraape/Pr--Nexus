"""Entrypoint for the FastAPI backend application."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.endpoints import router as api_router
from backend.core.config import settings
from backend.database import Base, engine
from backend.graph import create_graph
from backend.services.repositories import SQLAlchemyStatusRepository
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
    """Inicializa recursos necessários ao subir o serviço."""

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
