from __future__ import annotations

import json
import logging
import os
import threading
from typing import Dict, Generator, Iterable, List, Optional, Tuple
from uuid import uuid4

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction

try:
    from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
except ImportError:  # pragma: no cover - optional dependency
    SentenceTransformerEmbeddingFunction = None  # type: ignore[assignment]

from backend.core.config import Settings
from backend.services.llm_client import LLMClient, LLMClientError


logger = logging.getLogger(__name__)


class ConsultantAgentError(RuntimeError):
    """Raised when the consultant agent cannot complete an operation."""


class _FallbackEmbeddingFunction(EmbeddingFunction):
    """Deterministic embedding function used when sentence-transformers is unavailable."""

    def __init__(self, dimension: int = 384) -> None:
        self._dimension = dimension

    def __call__(self, input: Documents) -> List[List[float]]:  # type: ignore[override]
        logger.info(f"Fallback embedding for {len(input)} documents.")
        embeddings = [[0.0] * self._dimension for _ in input]
        return embeddings


class ConsultantAgent:
    """RAG-enabled fiscal consultant built on top of Gemini or DeepSeek."""

    def __init__(self, settings: Settings, llm_client: Optional[LLMClient] = None) -> None:
        self._settings = settings
        self._reports: Dict[str, Dict] = {}
        self._metadata: Dict[str, Dict] = {}
        self._lock = threading.RLock()

        self._client = chromadb.PersistentClient(
            path=str(settings.chroma_persist_directory)
        )
        self._collection = self._client.get_or_create_collection(
            name="fiscal_reports",
            embedding_function=self._resolve_embedding_function(settings),
        )

        try:
            self._llm = llm_client or LLMClient(settings)
        except LLMClientError as exc:
            raise ConsultantAgentError(str(exc)) from exc

    @staticmethod
    def _resolve_embedding_function(settings: Settings) -> EmbeddingFunction:
        model_name = settings.embedding_model_name
        allow_remote = os.getenv("ALLOW_REMOTE_EMBEDDINGS", "0").lower() in {
            "1",
            "true",
            "yes",
        }

        if not allow_remote:
            logger.info(
                "Remote embedding downloads disabled. Using fallback embeddings. Set "
                "ALLOW_REMOTE_EMBEDDINGS=1 to enable SentenceTransformer downloads.",
            )
            return _FallbackEmbeddingFunction()

        if SentenceTransformerEmbeddingFunction is None:
            logger.warning(
                "sentence-transformers is not installed. Falling back to zero embeddings."
            )
            return _FallbackEmbeddingFunction()

        try:
            return SentenceTransformerEmbeddingFunction(model_name=model_name)
        except Exception as exc:  # pragma: no cover - requires external services
            logger.warning(
                "Failed to load embedding model '%s': %s. Falling back to zero embeddings.",
                model_name,
                exc,
            )
            return _FallbackEmbeddingFunction()

    def index_report(
        self,
        report_id: str,
        report: Dict,
        *,
        metadata: Optional[Dict] = None,
    ) -> None:
        """Index a full report inside ChromaDB for future retrieval."""

        metadata_payload = dict(metadata or {})
        metadata_payload.setdefault("report_id", report_id)
        flattened = self._flatten_report(report, metadata_payload)
        if not flattened:
            raise ConsultantAgentError("Report does not contain any indexable sections.")

        with self._lock:
            self._collection.delete(where={"report_id": report_id})
            ids, documents, metadatas = zip(*flattened)
            self._collection.upsert(
                ids=list(ids),
                documents=list(documents),
                metadatas=list(metadatas),
            )
            self._reports[report_id] = report
            if metadata_payload:
                self._metadata[report_id] = metadata_payload

    def chat(
        self,
        report_id: str,
        question: str,
        history: List[Dict[str, str]],
        *,
        stream: bool = False,
    ) -> Dict:
        """Answer a question using RAG and the configured LLM."""

        prompt, schema = self._build_prompt(report_id, question, history)
        if stream:
            raise ConsultantAgentError("Streaming deve ser tratado via stream_chat().")

        try:
            response_text = self._llm.generate(
                prompt,
                response_mime="application/json",
                response_schema=schema,
            )
        except LLMClientError as exc:
            raise ConsultantAgentError(str(exc)) from exc
        return self.parse_response(response_text)

    def stream_chat(
        self,
        report_id: str,
        question: str,
        history: List[Dict[str, str]],
    ) -> Generator[str, None, Dict]:
        """Stream tokens from the LLM and return the parsed JSON at the end."""

        prompt, schema = self._build_prompt(report_id, question, history)
        accumulated = ""
        try:
            for chunk in self._llm.stream(
                prompt,
                response_mime="application/json",
                response_schema=schema,
            ):
                if not chunk:
                    continue
                accumulated += chunk
                yield chunk
        except LLMClientError as exc:
            raise ConsultantAgentError(str(exc)) from exc
        return self.parse_response(accumulated)

    # ------------------------------------------------------------------
    # Prompt Construction and Retrieval
    # ------------------------------------------------------------------

    def _flatten_report(
        self, report: Dict, metadata: Optional[Dict]
    ) -> List[Tuple[str, str, Dict]]:
        items: List[Tuple[str, str, Dict]] = []
        report_id = (metadata or {}).get("report_id") or report.get("id") or uuid4().hex

        def add_document(text: str, section: str, extra: Optional[Dict] = None) -> None:
            document_id = f"{report_id}-{uuid4().hex}"
            payload = {
                "report_id": report_id,
                "section": section,
            }
            if extra:
                payload.update(extra)
            items.append((document_id, text, payload))

        summary = report.get("summary")
        if isinstance(summary, dict):
            summary_text = "\n".join(
                filter(
                    None,
                    [
                        summary.get("title"),
                        summary.get("summary"),
                        "Principais métricas:" if summary.get("keyMetrics") else None,
                        *[
                            f"- {metric.get('metric')}: {metric.get('value')}"
                            for metric in summary.get("keyMetrics", [])
                        ],
                    ],
                )
            )
            if summary_text:
                add_document(summary_text, "summary")

        aggregated = report.get("aggregatedMetrics") or {}
        if isinstance(aggregated, dict):
            metrics_text = "\n".join(
                f"{key}: {value}" for key, value in aggregated.items()
            )
            if metrics_text:
                add_document(metrics_text, "aggregatedMetrics")

        ai_insights = report.get("aiDrivenInsights") or []
        for insight in ai_insights:
            if isinstance(insight, dict):
                add_document(
                    json.dumps(insight, ensure_ascii=False),
                    "aiDrivenInsights",
                )

        cross_results = report.get("crossValidationResults") or []
        for result in cross_results:
            if isinstance(result, dict):
                add_document(
                    json.dumps(result, ensure_ascii=False),
                    "crossValidationResults",
                )

        deterministic = report.get("deterministicCrossValidation") or []
        for discrepancy in deterministic:
            if isinstance(discrepancy, dict):
                add_document(
                    json.dumps(discrepancy, ensure_ascii=False),
                    "deterministicCrossValidation",
                )

        documents = report.get("documents") or []
        for document in documents:
            if not isinstance(document, dict):
                continue
            base = {
                "document": document.get("doc", {}).get("name"),
                "status": document.get("status"),
            }
            inconsistencies = document.get("inconsistencies") or []
            for inconsistency in inconsistencies:
                if isinstance(inconsistency, dict):
                    add_document(
                        json.dumps(inconsistency, ensure_ascii=False),
                        "inconsistency",
                        base,
                    )

        if metadata:
            data_sample = metadata.get("data_sample")
            if data_sample:
                add_document(str(data_sample), "dataSample")

        return items

    def _retrieve_context(self, report_id: str, question: str) -> List[str]:
        try:
            results = self._collection.query(
                query_texts=[question],
                n_results=self._settings.rag_top_k,
                where={"report_id": report_id},
            )
        except AttributeError as exc:
            logger.warning("Embedding backend does not support queries; skipping retrieval: %s", exc)
            return []
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Failed to retrieve context for report %s: %s", report_id, exc)
            return []
        documents: Documents = results.get("documents", [])  # type: ignore[assignment]
        if not documents:
            return []
        return [doc for doc in documents[0] if doc]

    def _build_prompt(
        self,
        report_id: str,
        question: str,
        history: List[Dict[str, str]],
    ) -> Tuple[str, Dict]:
        report = self._reports.get(report_id)
        metadata = self._metadata.get(report_id, {})
        context_snippets = self._retrieve_context(report_id, question)

        history_tail = history[-self._settings.max_history_messages :]
        history_text = "\n".join(
            f"{entry['role'].upper()}: {entry['content']}"
            for entry in history_tail
            if entry.get("role") and entry.get("content")
        )

        aggregated = report.get("aggregatedMetrics") if isinstance(report, dict) else None
        aggregated_text = (
            json.dumps(aggregated, ensure_ascii=False, indent=2)
            if aggregated
            else "{}"
        )

        context_text = "\n- ".join(context_snippets)
        if context_text:
            context_text = "- " + context_text
        else:
            context_text = "- Nenhum trecho recuperado do relatório."

        prompt = f"""
Você é um consultor fiscal sênior respondendo perguntas sobre um relatório de auditoria.
Use os trechos recuperados para fundamentar a resposta. Quando os dados agregados forem mais confiáveis, priorize-os.

Trechos recuperados:
{context_text}

Métricas agregadas confiáveis:
{aggregated_text}

Histórico recente da conversa (mais recente por último):
{history_text or 'Nenhuma interação anterior relevante.'}

Pergunta do usuário:
{question}

Responda em Português do Brasil. Sua resposta DEVE ser um objeto JSON válido com o seguinte formato:
{{
  "text": "resposta em markdown",
  "chartData": {{
    "type": "bar" | "pie" | "line" | "scatter",
    "title": "Título do gráfico",
    "data": [{{ "label": string, "value": number, "x": number opcional }}],
    "xAxisLabel": string opcional,
    "yAxisLabel": string opcional
  }} ou null
}}
Inclua "chartData" apenas quando um gráfico ajudar a explicar a resposta.
Se não houver dados suficientes para responder, explique a limitação.
"""

        schema = {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "chartData": {
                    "type": "object",
                    "nullable": True,
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["bar", "pie", "line", "scatter"],
                        },
                        "title": {"type": "string"},
                        "data": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                    "value": {"type": "number"},
                                    "x": {"type": "number"},
                                },
                                "required": ["label", "value"],
                            },
                        },
                        "xAxisLabel": {"type": "string"},
                        "yAxisLabel": {"type": "string"},
                    },
                    "required": ["type", "title", "data"],
                },
            },
            "required": ["text"],
        }
        return prompt, schema

    @staticmethod
    def parse_response(response_text: str) -> Dict:
        if not response_text:
            raise ConsultantAgentError(
                "O modelo retornou uma resposta vazia."
            )
        try:
            payload = json.loads(response_text)
        except json.JSONDecodeError as exc:  # pragma: no cover - depends on model
            raise ConsultantAgentError(
                "A resposta do modelo não estava em JSON válido."
            ) from exc

        if "text" not in payload:
            raise ConsultantAgentError(
                "A resposta JSON não contém o campo obrigatório 'text'."
            )
        if "chartData" not in payload or payload.get("chartData") in ({}, [], ""):
            payload["chartData"] = None
        return payload
