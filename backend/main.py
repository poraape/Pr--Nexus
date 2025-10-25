from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.endpoints import router as consultant_router

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(title="Nexus Fiscal Consultant API", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"]
    )

    app.include_router(consultant_router)

    @app.get("/health", tags=["health"])  # pragma: no cover - convenience
    def health_check() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
