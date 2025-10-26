from __future__ import annotations

from typing import Dict, Iterable, Optional

try:
    import google.generativeai as genai
except ImportError:  # pragma: no cover - optional dependency
    genai = None  # type: ignore[assignment]

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency
    OpenAI = None  # type: ignore[assignment]

from backend.core.config import Settings


class LLMClientError(RuntimeError):
    """Raised when the LLM client cannot complete an operation."""


class LLMClient:
    """Hybrid client: prefers Gemini free model; uses DeepSeek for heavy/offline tasks."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._provider = settings.llm_provider.lower()
        self._gemini = None
        self._deepseek = None

        if settings.gemini_api_key and genai is not None:
            genai.configure(api_key=settings.gemini_api_key)
            self._gemini = genai.GenerativeModel(settings.gemini_model)
        if settings.deepseek_api_key and OpenAI is not None:
            self._deepseek = OpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")

        if self._provider == "gemini" and not self._gemini:
            raise LLMClientError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini.")
        if self._provider == "deepseek" and not self._deepseek:
            raise LLMClientError("DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek.")
        if self._provider == "hybrid" and not (self._gemini or self._deepseek):
            raise LLMClientError("At least one provider must be configured for hybrid mode.")

    def _choose_provider(self, prompt: str, *, response_schema: Optional[Dict]) -> str:
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
        if provider == "gemini":
            generation_config = {"response_mime_type": response_mime}
            if response_schema:
                generation_config["response_schema"] = response_schema
            result = self._gemini.generate_content(prompt, generation_config=generation_config)
            return getattr(result, "text", "")
        messages = [
            {"role": "system", "content": ("Responda em JSON valido." if response_mime == "application/json" else "Responda em Portugues.")},
            {"role": "user", "content": prompt},
        ]
        completion = self._deepseek.chat.completions.create(model=model or self._settings.deepseek_model, messages=messages, stream=False)
        return completion.choices[0].message.content or ""

    def stream(self, prompt: str, *, response_mime: str = "text/plain", response_schema: Optional[Dict] = None, model: Optional[str] = None) -> Iterable[str]:
        provider = self._choose_provider(prompt, response_schema=response_schema)
        if provider == "gemini":
            generation_config = {"response_mime_type": response_mime}
            if response_schema:
                generation_config["response_schema"] = response_schema
            stream = self._gemini.generate_content(prompt, generation_config=generation_config, stream=True)
            for chunk in stream:
                text = getattr(chunk, "text", "")
                if text:
                    yield text
            return
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
