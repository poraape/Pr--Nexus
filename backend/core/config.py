"""Application settings utilities."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional, Tuple

from pydantic import Field, model_validator
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
        default="sqlite+aiosqlite:///data/nexus.db",
        description="Database connection string used by SQLAlchemy.",
        alias="POSTGRES_DSN",
        validation_alias="POSTGRES_DSN",
    )
    storage_path: Path = Field(
        default=Path("/data/uploads"),
        description="Directory where uploaded files are persisted before processing.",
        alias="STORAGE_PATH",
        validation_alias="STORAGE_PATH",
    )
    chroma_persist_directory: Path = Field(
        default=Path("/data/chroma"),
        description="Directory where ChromaDB collections are persisted.",
        alias="CHROMA_PERSIST_DIRECTORY",
        validation_alias="CHROMA_PERSIST_DIRECTORY",
    )
    runtime_dir: Optional[Path] = Field(
        default=None,
        description="Base directory for runtime data (used to derive storage paths when provided).",
        alias="SPACE_RUNTIME_DIR",
        validation_alias="SPACE_RUNTIME_DIR",
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
    llm_provider: Literal["gemini", "deepseek", "hybrid"] = Field(
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
        default="gemini-2.5-flash",
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
    max_history_messages: int = Field(
        default=6,
        ge=0,
        description="Maximum number of previous chat messages to include in the RAG prompt.",
        alias="MAX_HISTORY_MESSAGES",
        validation_alias="MAX_HISTORY_MESSAGES",
    )
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def _normalize_directories(self) -> "Settings":
        """Normalize storage paths and apply runtime directory overrides."""

        if self.runtime_dir is not None:
            resolved_runtime = self.runtime_dir.expanduser().resolve()
            self.runtime_dir = resolved_runtime
        else:
            resolved_runtime = None

        if resolved_runtime and "storage_path" not in self.model_fields_set:
            self.storage_path = (resolved_runtime / "uploads").resolve()
        else:
            self.storage_path = self.storage_path.expanduser().resolve()

        if resolved_runtime and "chroma_persist_directory" not in self.model_fields_set:
            self.chroma_persist_directory = (resolved_runtime / "chroma").resolve()
        else:
            self.chroma_persist_directory = self.chroma_persist_directory.expanduser().resolve()

        return self

    @property
    def sqlalchemy_sync_url(self) -> str:
        """Return a SQLAlchemy URL compatible with synchronous engines."""

        from sqlalchemy.engine import make_url

        url = make_url(self.postgres_dsn)
        if "+aiosqlite" in url.drivername:
            url = url.set(drivername=url.drivername.replace("+aiosqlite", "+pysqlite"))
        return str(url)

    @property
    def storage_directories(self) -> Tuple[Path, Path]:
        """Convenience tuple containing the storage and embedding directories."""

        return self.storage_path, self.chroma_persist_directory

    @property
    def database_path(self) -> Optional[Path]:
        """Return the filesystem path for file-based databases if available."""

        from sqlalchemy.engine import make_url

        url = make_url(self.sqlalchemy_sync_url)
        if not url.drivername.startswith("sqlite"):
            return None

        database = url.database
        if database in (None, ":memory:", ""):
            return None

        db_path = Path(database)
        return db_path if db_path.is_absolute() else (Path.cwd() / db_path)

    @property
    def directories_to_ensure(self) -> Tuple[Path, ...]:
        """Directories that should exist before processing starts."""

        paths = {self.storage_path.resolve(), self.chroma_persist_directory.resolve()}
        db_path = self.database_path
        if db_path is not None:
            paths.add(db_path.parent.resolve())
        return tuple(paths)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""

    return Settings()  # type: ignore[call-arg]


settings = get_settings()

