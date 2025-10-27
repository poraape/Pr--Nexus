from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, Dict, Iterable, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from backend.agents.consultant_agent import ConsultantAgent, ConsultantAgentError
from backend.core.config import get_settings
from backend.database import get_session
from backend.database.models import Task
from backend.services.llm_client import LLMClient, LLMClientError
from backend.services.repositories import SQLAlchemyReportRepository, SQLAlchemyStatusRepository
from backend.services.storage import FileStorage
from backend.services.task_queue import InlineTaskPublisher, RabbitMQPublisher, TaskPublisher
from backend.types import AgentPhase
from backend.worker import AuditWorker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")

_settings = get_settings()
_consultant_disabled = os.getenv("DISABLE_CONSULTANT_AGENT") == "1"

_agent: Optional[ConsultantAgent]
if not _consultant_disabled:
    try:
        _llm_client = LLMClient(_settings)
    except LLMClientError as exc:  # pragma: no cover - hard failure
        logger.exception("Failed to initialize LLM client")
        raise

    _agent = ConsultantAgent(_settings, llm_client=_llm_client)
else:  # pragma: no cover - only used in constrained test environments
    _llm_client = None
    try:
        # Tests may provide a lightweight stub agent even when the consultant is disabled.
        _agent = ConsultantAgent(_settings)  # type: ignore[call-arg]
        logger.info("Consultant agent instantiated in disabled mode (likely using test stub).")
    except Exception:  # pragma: no cover - defensive fallback
        _agent = None
_storage = FileStorage(_settings.storage_path)
_status_repository = SQLAlchemyStatusRepository()
_report_repository = SQLAlchemyReportRepository()
_worker = AuditWorker(status_repository=_status_repository, report_repository=_report_repository, storage=_storage)

if _settings.task_dispatch_mode == "rabbitmq":  # pragma: no cover - depends on infrastructure
    try:
        _publisher: TaskPublisher = RabbitMQPublisher(_settings.rabbitmq_url, queue=_settings.rabbitmq_queue)
    except Exception:  # pragma: no cover - defensive
        logger.exception("Failed to initialize RabbitMQ publisher, falling back to inline dispatcher")
        _publisher = InlineTaskPublisher(_worker)
else:
    _publisher = InlineTaskPublisher(_worker)


class HistoryMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str
    chartData: Optional[Dict[str, Any]] = None


class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    question: Optional[str] = None
    history: List[HistoryMessage] = Field(default_factory=list)
    report: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    stream: bool = False


class GenerateJsonRequest(BaseModel):
    prompt: str
    model: Optional[str] = None
    response_schema: Optional[Dict[str, Any]] = Field(default=None, alias="schema")

    model_config = ConfigDict(populate_by_name=True)


class UploadResponse(BaseModel):
    task_id: uuid.UUID
    status: str


class BackendAgentState(BaseModel):
    status: str
    progress: Optional[Dict[str, Any]] = None


class StatusResponse(BaseModel):
    task_id: uuid.UUID
    status: str
    progress: int
    original_filename: Optional[str]
    created_at: str
    updated_at: str
    message: Optional[str] = None
    agents: Dict[str, BackendAgentState] = Field(default_factory=dict)


class ReportResponse(BaseModel):
    task_id: uuid.UUID
    content: Dict[str, Any]
    generated_at: str


class ClassificationUpdate(BaseModel):
    document_name: str = Field(..., alias="documentName")
    operation_type: str = Field(..., alias="operationType")

    model_config = ConfigDict(populate_by_name=True)


def _format_history(history: List[HistoryMessage]) -> List[Dict[str, str]]:
    return [{"role": item.role, "content": item.content} for item in history]


def _initial_agent_state(total_files: int) -> Dict[str, Dict[str, Any]]:
    base = {
        phase.value: {"status": "pending", "progress": {"step": "Aguardando processamento", "current": 0, "total": 0}}
        for phase in AgentPhase
    }
    base[AgentPhase.OCR.value]["progress"] = {
        "step": "Arquivos enfileirados para OCR",
        "current": 0,
        "total": total_files,
    }
    return base


@router.post("/chat", tags=["consultant"])
def chat_endpoint(payload: ChatRequest) -> Response:
    return _handle_chat(payload)


@router.get("/chat", tags=["consultant"])
def chat_stream(encoded_payload: str = Query(..., alias="payload")) -> Response:
    try:
        data = json.loads(encoded_payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload de streaming inválido.",
        ) from exc

    request = ChatRequest(**data)
    request.stream = True
    if request.report:
        logger.warning("Report data cannot be indexed via streaming GET request.")
        request.report = None
    return _handle_chat(request)


@router.post("/llm/generate-json", tags=["consultant"])
def generate_json(payload: GenerateJsonRequest) -> Response:
    if _llm_client is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="LLM indisponível no momento.")

    try:
        raw_response = _llm_client.generate(
            payload.prompt,
            response_mime="application/json",
            response_schema=payload.response_schema,
            model=payload.model,
        )
        parsed = json.loads(raw_response)
        return JSONResponse({"result": parsed})
    except LLMClientError as exc:
        logger.warning("LLM JSON generation error: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except json.JSONDecodeError as exc:  # pragma: no cover - depends on model output
        logger.error("Model returned invalid JSON: %s", raw_response)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="A resposta do modelo não estava em JSON válido.") from exc


def _handle_chat(payload: ChatRequest) -> Response:
    if _agent is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Consultor indisponível no momento.")

    try:
        if payload.report:
            _agent.index_report(
                payload.session_id,
                payload.report,
                metadata=payload.metadata,
            )

        if not payload.question:
            return JSONResponse({"status": "indexed"}, status_code=status.HTTP_200_OK)

        history = _format_history(payload.history)

        if payload.stream:
            return _build_streaming_response(payload.session_id, payload.question, history)

        result = _agent.chat(payload.session_id, payload.question, history)
        return JSONResponse({"sessionId": payload.session_id, "message": result})
    except ConsultantAgentError as exc:
        logger.warning("Consultant agent error: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Unexpected error while processing chat request")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro interno no consultor fiscal.",
        ) from exc


def _build_streaming_response(
    session_id: str,
    question: str,
    history: List[Dict[str, str]],
) -> StreamingResponse:
    def event_stream() -> Iterable[bytes]:
        accumulated = ""
        try:
            generator = _agent.stream_chat(session_id, question, history)
            while True:
                try:
                    chunk = next(generator)
                    if not chunk:
                        continue
                    accumulated += chunk
                    event = json.dumps({"type": "chunk", "content": chunk}, ensure_ascii=False)
                    yield f"data: {event}\n\n".encode("utf-8")
                except StopIteration as stop:
                    final_payload = stop.value if stop.value is not None else _agent.parse_response(accumulated)
                    data = json.dumps({"type": "final", "message": final_payload}, ensure_ascii=False)
                    yield f"data: {data}\n\n".encode("utf-8")
                    break
        except ConsultantAgentError as exc:
            error = json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False)
            yield f"data: {error}\n\n".encode("utf-8")
        except Exception:  # pragma: no cover - defensive
            logger.exception("Unexpected streaming failure")
            error = json.dumps({"type": "error", "message": "Erro interno no consultor fiscal."}, ensure_ascii=False)
            yield f"data: {error}\n\n".encode("utf-8")

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED, tags=["tasks"])
async def upload_files(files: List[UploadFile] = File(...), db: Session = Depends(get_session)) -> UploadResponse:
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nenhum arquivo foi enviado.")

    task = Task(status="PENDING", progress=0)
    db.add(task)
    db.flush()

    saved_references: List[Dict[str, Any]] = []
    try:
        for upload in files:
            reference = await _storage.persist_upload(str(task.id), upload)
            saved_references.append(reference)
    except Exception as exc:
        logger.exception("Failed to persist uploaded files for task %s", task.id)
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao salvar arquivos para análise.") from exc

    task.original_filename = ", ".join(ref.get("original_name", "") for ref in saved_references if ref.get("original_name")) or None
    task.input_metadata = {"files": saved_references}
    task.agent_status = _initial_agent_state(len(files))
    db.commit()

    try:
        _publisher.publish({"task_id": str(task.id), "files": saved_references})
    except Exception as exc:
        logger.exception("Failed to enqueue task %s", task.id)
        _status_repository.update_task_status(str(task.id), "FAILURE", detail="Falha ao enfileirar tarefa para processamento.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao enfileirar tarefa para processamento.") from exc

    return UploadResponse(task_id=task.id, status=task.status)


@router.get("/status/{task_id}", response_model=StatusResponse, tags=["tasks"])
async def get_status(task_id: uuid.UUID, db: Session = Depends(get_session)) -> StatusResponse:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task não encontrada.")

    agents = {
        name: BackendAgentState(status=str(payload.get("status", "pending")), progress=payload.get("progress"))
        for name, payload in (task.agent_status or {}).items()
    }

    return StatusResponse(
        task_id=task.id,
        status=task.status,
        progress=task.progress,
        original_filename=task.original_filename,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
        message=task.error_message,
        agents=agents,
    )


@router.get("/report/{task_id}", response_model=ReportResponse, tags=["tasks"])
async def get_report(task_id: uuid.UUID, db: Session = Depends(get_session)) -> ReportResponse:
    task = db.get(Task, task_id)
    if task is None or task.report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relatório não encontrado.")

    report = task.report
    return ReportResponse(task_id=task.id, content=report.content, generated_at=report.updated_at.isoformat())


@router.patch("/report/{task_id}/classification", status_code=status.HTTP_204_NO_CONTENT, tags=["tasks"])
async def update_classification(task_id: uuid.UUID, payload: ClassificationUpdate, db: Session = Depends(get_session)) -> Response:
    task = db.get(Task, task_id)
    if task is None or task.report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relatório não encontrado para atualização.")

    content = dict(task.report.content)
    documents = content.get("documents")
    updated = False
    if isinstance(documents, list):
        for document in documents:
            doc_info = document.get("doc")
            if isinstance(doc_info, dict) and doc_info.get("name") == payload.document_name:
                classification = document.get("classification")
                if isinstance(classification, dict):
                    classification["operationType"] = payload.operation_type
                    classification["confidence"] = 1.0
                    updated = True
                    break
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento não encontrado para atualização.")

    task.report.content = content
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
