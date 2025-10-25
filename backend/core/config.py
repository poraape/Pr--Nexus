from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Settings(BaseModel):
    """Application settings loaded from environment variables."""

    chroma_persist_directory: Path = Field(
        default=Path("backend/.chroma"),
        description="Directory where ChromaDB collections are persisted.",
        alias="CHROMA_PERSIST_DIRECTORY",
    )
    embedding_model_name: str = Field(
        default="all-MiniLM-L6-v2",
        description="Sentence transformer model used to embed report passages.",
        alias="EMBEDDING_MODEL_NAME",
    )
    rag_top_k: int = Field(
        default=6,
        ge=1,
        description="Number of passages retrieved from ChromaDB during RAG queries.",
        alias="RAG_TOP_K",
    )
    llm_provider: Literal["gemini", "deepseek"] = Field(
        default="gemini",
        description="Provider used to answer questions.",
        alias="LLM_PROVIDER",
    )
    gemini_api_key: Optional[str] = Field(
        default=None,
        description="Google Gemini API key.",
        alias="GEMINI_API_KEY",
    )
    gemini_model: str = Field(
        default="gemini-2.0-flash",
        description="Gemini model identifier.",
        alias="GEMINI_MODEL",
    )
    deepseek_api_key: Optional[str] = Field(
        default=None,
        description="DeepSeek API key (only required when LLM_PROVIDER=deepseek).",
        alias="DEEPSEEK_API_KEY",
    )
    deepseek_model: str = Field(
        default="deepseek-chat",
        description="DeepSeek model identifier.",
        alias="DEEPSEEK_MODEL",
    )
    max_history_messages: int = Field(
        default=6,
        ge=0,
        description="Maximum number of past messages injected in the prompt.",
        alias="MAX_HISTORY_MESSAGES",
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""

    settings = Settings()  # type: ignore[call-arg]
    settings.chroma_persist_directory.mkdir(parents=True, exist_ok=True)
    return settings
