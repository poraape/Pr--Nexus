"""Application settings utilities."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    frontend_origin: str = Field(
        default="*",
        description="Origin allowed to access the API.",
        alias="FRONTEND_ORIGIN",
        validation_alias="FRONTEND_ORIGIN",
    )
    postgres_dsn: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/nexus",
        description="Database connection string used by SQLAlchemy.",
        alias="POSTGRES_DSN",
        validation_alias="POSTGRES_DSN",
    )
    storage_path: Path = Field(
        default=Path("backend/storage/uploads"),
        description="Directory where uploaded files are persisted before processing.",
        alias="STORAGE_PATH",
        validation_alias="STORAGE_PATH",
    )
    task_dispatch_mode: Literal["inline", "rabbitmq"] = Field(
        default="inline",
        description="Strategy used to dispatch tasks to workers.",
        alias="TASK_DISPATCH_MODE",
        validation_alias="TASK_DISPATCH_MODE",
    )
    rabbitmq_url: str = Field(
        default="amqp://guest:guest@localhost:5672/",
        description="Connection URL for RabbitMQ when task_dispatch_mode=rabbitmq.",
        alias="RABBITMQ_URL",
        validation_alias="RABBITMQ_URL",
    )
    rabbitmq_queue: str = Field(
        default="audit_tasks",
        description="Queue name used for audit task messages.",
        alias="RABBITMQ_QUEUE",
        validation_alias="RABBITMQ_QUEUE",
    )
    chroma_persist_directory: Path = Field(
        default=Path("backend/.chroma"),
        description="Directory where ChromaDB collections are persisted.",
        alias="CHROMA_PERSIST_DIRECTORY",
        validation_alias="CHROMA_PERSIST_DIRECTORY",
    )
    embedding_model_name: str = Field(
        default="all-MiniLM-L6-v2",
        description="Sentence transformer model used to embed report passages.",
        alias="EMBEDDING_MODEL_NAME",
        validation_alias="EMBEDDING_MODEL_NAME",
    )
    rag_top_k: int = Field(
        default=6,
        ge=1,
        description="Number of passages retrieved from ChromaDB during RAG queries.",
        alias="RAG_TOP_K",
        validation_alias="RAG_TOP_K",
    )
    llm_provider: Literal["gemini", "deepseek"] = Field(
        default="gemini",
        description="Provider used to answer questions.",
        alias="LLM_PROVIDER",
        validation_alias="LLM_PROVIDER",
    )
    gemini_api_key: Optional[str] = Field(
        default=None,
        description="Google Gemini API key.",
        alias="GEMINI_API_KEY",
        validation_alias="GEMINI_API_KEY",
    )
    gemini_model: str = Field(
        default="gemini-1.5-flash-8b",
        description="Gemini model identifier.",
        alias="GEMINI_MODEL",
        validation_alias="GEMINI_MODEL",
    )
    deepseek_api_key: Optional[str] = Field(
        default=None,
        description="DeepSeek API key (only required when LLM_PROVIDER=deepseek).",
        alias="DEEPSEEK_API_KEY",
        validation_alias="DEEPSEEK_API_KEY",
    )
    deepseek_model: str = Field(
        default="deepseek-chat",
        description="DeepSeek model identifier.",
        alias="DEEPSEEK_MODEL",
        validation_alias="DEEPSEEK_MODEL",
    )
    deepseek_cutover_chars: int = Field(
        default=4000,
        ge=1000,
        description="Prompt length threshold to prefer DeepSeek in hybrid mode.",
        alias="DEEPSEEK_CUTOVER_CHARS",
        validation_alias="DEEPSEEK_CUTOVER_CHARS",
    )
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""

    settings = Settings()  # type: ignore[call-arg]
    settings.chroma_persist_directory.mkdir(parents=True, exist_ok=True)
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    return settings


settings = get_settings()

