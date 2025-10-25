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
    """Thin wrapper around Gemini or DeepSeek clients."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        provider = settings.llm_provider.lower()

        if provider == "gemini":
            if not settings.gemini_api_key:
                raise LLMClientError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini.")
            if genai is None:
                raise LLMClientError("google-generativeai package is not installed.")
            genai.configure(api_key=settings.gemini_api_key)
            self._client = genai.GenerativeModel(settings.gemini_model)
            self._provider = "gemini"
        elif provider == "deepseek":
            if not settings.deepseek_api_key:
                raise LLMClientError("DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek.")
            if OpenAI is None:
                raise LLMClientError("openai package is required for DeepSeek integration.")
            self._client = OpenAI(
                api_key=settings.deepseek_api_key,
                base_url="https://api.deepseek.com",
            )
            self._provider = "deepseek"
        else:  # pragma: no cover - validated by settings
            raise LLMClientError(f"Unsupported LLM provider: {provider}")

    def generate(
        self,
        prompt: str,
        *,
        response_mime: str = "text/plain",
        response_schema: Optional[Dict] = None,
        model: Optional[str] = None,
    ) -> str:
        if self._provider == "gemini":
            generation_config = {"response_mime_type": response_mime}
            if response_schema:
                generation_config["response_schema"] = response_schema
            result = self._client.generate_content(
                prompt,
                generation_config=generation_config,
            )
            return getattr(result, "text", "")

        # DeepSeek
        messages = [
            {
                "role": "system",
                "content": (
                    "Responda em JSON válido." if response_mime == "application/json" else "Responda em Português."
                ),
            },
            {"role": "user", "content": prompt},
        ]
        completion = self._client.chat.completions.create(
            model=model or self._settings.deepseek_model,
            messages=messages,
            stream=False,
        )
        return completion.choices[0].message.content or ""

    def stream(
        self,
        prompt: str,
        *,
        response_mime: str = "text/plain",
        response_schema: Optional[Dict] = None,
        model: Optional[str] = None,
    ) -> Iterable[str]:
        if self._provider == "gemini":
            generation_config = {"response_mime_type": response_mime}
            if response_schema:
                generation_config["response_schema"] = response_schema
            stream = self._client.generate_content(
                prompt,
                generation_config=generation_config,
                stream=True,
            )
            for chunk in stream:
                text = getattr(chunk, "text", "")
                if text:
                    yield text
            return

        messages = [
            {
                "role": "system",
                "content": (
                    "Responda em JSON válido." if response_mime == "application/json" else "Responda em Português."
                ),
            },
            {"role": "user", "content": prompt},
        ]
        stream = self._client.chat.completions.create(
            model=model or self._settings.deepseek_model,
            messages=messages,
            stream=True,
        )
        for event in stream:
            chunk = event.choices[0].delta.content or ""
            if chunk:
                yield chunk

    @property
    def settings(self) -> Settings:
        return self._settings
