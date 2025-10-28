from __future__ import annotations

import logging
from typing import Dict, Iterable, Optional

try:
    import google.generativeai as genai
except ImportError:  # pragma: no cover - optional dependency
    genai = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    from google.api_core import exceptions as google_exceptions  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - optional dependency
    google_exceptions = None  # type: ignore[assignment]

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency
    OpenAI = None  # type: ignore[assignment]

from backend.core.config import Settings

logger = logging.getLogger(__name__)


class LLMClientError(RuntimeError):
    """Raised when the LLM client cannot complete an operation."""


class LLMClient:
    """Hybrid client: prefers Gemini free model; uses DeepSeek for heavy/offline tasks."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._provider = settings.llm_provider.lower()
        self._gemini = None
        self._gemini_models: list[str] = []
        self._gemini_index: int = -1
        self._deepseek = None

        if settings.gemini_api_key and genai is not None:
            genai.configure(api_key=settings.gemini_api_key)
            candidates = [
                settings.gemini_model,
                "gemini-2.5-flash",
                "gemini-2.5-flash-latest",
                "gemini-1.5-flash",
                "gemini-1.5-flash-latest",
            ]
            seen: list[str] = []
            for candidate in candidates:
                if candidate and candidate not in seen:
                    seen.append(candidate)
            self._gemini_models = seen
            for index, model_name in enumerate(self._gemini_models):
                if self._initialise_gemini(model_name):
                    self._gemini_index = index
                    break
            if self._gemini is None and self._gemini_models:
                logger.warning(
                    "Falha ao inicializar qualquer modelo Gemini dentre %s",
                    ", ".join(self._gemini_models),
                )

        if settings.deepseek_api_key and OpenAI is not None:
            self._deepseek = OpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")

        if not (self._gemini or self._deepseek):
            self._provider = "stub"

    def _initialise_gemini(self, model_name: str) -> bool:
        try:
            self._gemini = genai.GenerativeModel(model_name)
            logger.info("Modelo Gemini ativo: %s", model_name)
            return True
        except Exception as exc:  # pragma: no cover - depende do SDK externo
            logger.warning("Falha ao inicializar Gemini '%s': %s", model_name, exc)
            self._gemini = None
            return False

    def _handle_gemini_failure(self, exc: Exception) -> bool:
        """Return True if we recovered (e.g., switching model), False otherwise."""
        if self._gemini is None:
            return False

        message = str(exc).lower()
        can_try_fallback = False
        if google_exceptions is not None and isinstance(exc, google_exceptions.GoogleAPIError):  # type: ignore[arg-type]
            can_try_fallback = True
        elif "not found" in message or "404" in message:
            can_try_fallback = True

        if not can_try_fallback:
            return False

        for index in range(self._gemini_index + 1, len(self._gemini_models)):
            model_name = self._gemini_models[index]
            if self._initialise_gemini(model_name):
                self._gemini_index = index
                return True

        logger.error("No alternate Gemini model available: %s", exc)
        self._gemini = None
        return False

    def _choose_provider(self, prompt: str, *, response_schema: Optional[Dict]) -> str:
        if self._provider == "stub":
            return "stub"
        if response_schema and self._gemini is not None:
            return "gemini"
        if self._provider == "hybrid" and self._deepseek is not None:
            if len(prompt) >= getattr(self._settings, "deepseek_cutover_chars", 4000):
                return "deepseek"
        if self._provider == "deepseek" and self._deepseek is not None:
            return "deepseek"
        if self._gemini is not None:
            return "gemini"
        if self._deepseek is not None:
            return "deepseek"
        raise LLMClientError("No LLM provider available.")

    def generate(self, prompt: str, *, response_mime: str = "text/plain", response_schema: Optional[Dict] = None, model: Optional[str] = None) -> str:
        provider = self._choose_provider(prompt, response_schema=response_schema)
        if provider == "stub":
            return "{}" if response_mime == "application/json" else ""
        if provider == "gemini":
            attempts = 0
            while True:
                if self._gemini is None:
                    break
                try:
                    generation_config = {"response_mime_type": response_mime}
                    if response_schema:
                        generation_config["response_schema"] = response_schema
                    result = self._gemini.generate_content(prompt, generation_config=generation_config)
                    return getattr(result, "text", "")
                except Exception as exc:  # pragma: no cover - depende do SDK externo
                    attempts += 1
                    if self._handle_gemini_failure(exc):
                        continue
                    logger.warning("Erro ao usar Gemini (%s); tentando fallback.", exc)
                    if self._deepseek is not None:
                        provider = "deepseek"
                        break
                    raise LLMClientError(str(exc)) from exc
                if attempts > 3:
                    break
        if provider == "gemini":
            raise LLMClientError("No Gemini model available to fulfil the request.")

        if self._deepseek is None:
            raise LLMClientError("DeepSeek is not configured.")

        messages = [
            {"role": "system", "content": ("Responda em JSON valido." if response_mime == "application/json" else "Responda em Portugues.")},
            {"role": "user", "content": prompt},
        ]
        completion = self._deepseek.chat.completions.create(model=model or self._settings.deepseek_model, messages=messages, stream=False)
        return completion.choices[0].message.content or ""

    def stream(self, prompt: str, *, response_mime: str = "text/plain", response_schema: Optional[Dict] = None, model: Optional[str] = None) -> Iterable[str]:
        provider = self._choose_provider(prompt, response_schema=response_schema)
        if provider == "stub":
            if response_mime == "application/json":
                yield "{}"
            else:
                yield ""
            return
        if provider == "gemini":
            while True:
                if self._gemini is None:
                    break
                try:
                    generation_config = {"response_mime_type": response_mime}
                    if response_schema:
                        generation_config["response_schema"] = response_schema
                    stream = self._gemini.generate_content(prompt, generation_config=generation_config, stream=True)
                    for chunk in stream:
                        text = getattr(chunk, "text", "")
                        if text:
                            yield text
                    return
                except Exception as exc:  # pragma: no cover - depende do SDK externo
                    if self._handle_gemini_failure(exc):
                        continue
                    logger.warning("Erro ao usar Gemini em modo streaming (%s); buscando fallback.", exc)
                    if self._deepseek is not None:
                        provider = "deepseek"
                        break
                    raise LLMClientError(str(exc)) from exc
            # se chegamos aqui e provider ainda e gemini mas sem fallback, cair para deepseek stub
        if provider == "gemini":
            raise LLMClientError("No Gemini model available for streaming.")

        if self._deepseek is None:
            raise LLMClientError("DeepSeek is not configured.")

        messages = [
            {"role": "system", "content": ("Responda em JSON valido." if response_mime == "application/json" else "Responda em Portugues.")},
            {"role": "user", "content": prompt},
        ]
        stream = self._deepseek.chat.completions.create(model=model or self._settings.deepseek_model, messages=messages, stream=True)
        for event in stream:
            chunk = event.choices[0].delta.content or ""
            if chunk:
                yield chunk

    @property
    def settings(self) -> Settings:
        return self._settings
