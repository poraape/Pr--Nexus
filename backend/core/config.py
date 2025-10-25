"""Application configuration utilities."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional


class Settings:
    """Container for application configuration sourced from environment variables."""

    GEMINI_API_KEY: Optional[str]
    POSTGRES_DSN: str
    RABBITMQ_URL: Optional[str]
    CHROMADB_PATH: Optional[str]
    FRONTEND_ORIGIN: str
    STORAGE_PATH: str
    ENVIRONMENT: str

    def __init__(self) -> None:
        self.GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
        self.POSTGRES_DSN = os.getenv("POSTGRES_DSN", "postgresql+psycopg://postgres:postgres@localhost:5432/nexus")
        self.RABBITMQ_URL = os.getenv("RABBITMQ_URL")
        self.CHROMADB_PATH = os.getenv("CHROMADB_PATH", "./backend/storage/chroma")
        self.FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
        self.STORAGE_PATH = os.getenv("STORAGE_PATH", "./backend/storage/uploads")
        self.ENVIRONMENT = os.getenv("ENVIRONMENT", "development")


@lru_cache
def get_settings() -> Settings:
    """Return a cached instance of :class:`Settings`."""

    return Settings()


settings = get_settings()
