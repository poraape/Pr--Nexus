<<<<<<< HEAD
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterable, List, Optional

from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from backend.agents.consultant_agent import ConsultantAgent, ConsultantAgentError
from backend.core.config import get_settings
from backend.services.llm_client import LLMClient, LLMClientError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["consultant"])
_settings = get_settings()

try:
    _llm_client = LLMClient(_settings)
except LLMClientError as exc:  # pragma: no cover - hard failure
    logger.exception("Failed to initialize LLM client")
    raise

_agent = ConsultantAgent(_settings, llm_client=_llm_client)


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
    schema: Optional[Dict[str, Any]] = None


def _format_history(history: List[HistoryMessage]) -> List[Dict[str, str]]:
    return [{"role": item.role, "content": item.content} for item in history]


@router.post("/chat")
def chat_endpoint(payload: ChatRequest) -> Response:
    return _handle_chat(payload)


@router.get("/chat")
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


@router.post("/llm/generate-json")
def generate_json(payload: GenerateJsonRequest) -> Response:
    try:
        raw_response = _llm_client.generate(
            payload.prompt,
            response_mime="application/json",
            response_schema=payload.schema,
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
=======
"""API route handlers for the backend service."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.database import get_session
from backend.database.models import Report, Task

router = APIRouter(prefix="/api/v1", tags=["api"])


class UploadResponse(BaseModel):
    task_id: uuid.UUID
    status: str


class StatusResponse(BaseModel):
    task_id: uuid.UUID
    status: str
    progress: int
    original_filename: str | None
    created_at: str
    updated_at: str


class ReportResponse(BaseModel):
    task_id: uuid.UUID
    content: dict[str, Any]
    generated_at: str


class ChatRequest(BaseModel):
    task_id: uuid.UUID | None = None
    message: str


class ChatResponse(BaseModel):
    task_id: uuid.UUID
    status: str
    response: str


async def _save_upload(file: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    contents = await file.read()
    with destination.open("wb") as buffer:
        buffer.write(contents)


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_file(file: UploadFile, db: Session = Depends(get_session)) -> UploadResponse:
    """Persist an uploaded file and create a task entry."""

    task_id = uuid.uuid4()
    sanitized_name = Path(file.filename or "upload").name
    storage_dir = Path(settings.STORAGE_PATH)
    storage_dir.mkdir(parents=True, exist_ok=True)
    destination = storage_dir / f"{task_id}_{sanitized_name}"

    await _save_upload(file, destination)

    task = Task(
        id=task_id,
        status="received",
        progress=0,
        original_filename=sanitized_name,
        storage_path=str(destination),
        input_metadata={"content_type": file.content_type},
    )
    db.add(task)
    db.commit()

    return UploadResponse(task_id=task_id, status=task.status)


@router.get("/status/{task_id}", response_model=StatusResponse)
async def get_status(task_id: uuid.UUID, db: Session = Depends(get_session)) -> StatusResponse:
    """Return the status of a processing task."""

    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    return StatusResponse(
        task_id=task.id,
        status=task.status,
        progress=task.progress,
        original_filename=task.original_filename,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@router.get("/report/{task_id}", response_model=ReportResponse)
async def get_report(task_id: uuid.UUID, db: Session = Depends(get_session)) -> ReportResponse:
    """Fetch the generated report for a task."""

    task = db.get(Task, task_id)
    if task is None or task.report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    report = task.report
    return ReportResponse(task_id=task.id, content=report.content, generated_at=report.updated_at.isoformat())


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, db: Session = Depends(get_session)) -> ChatResponse:
    """Register a chat interaction associated with a task."""

    if request.task_id is not None:
        task = db.get(Task, request.task_id)
        if task is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    else:
        task = Task(status="chat_received", progress=0)
        db.add(task)
        db.flush()

    response_text = f"Acknowledged message: {request.message}"

    if task.report is None:
        report = Report(task_id=task.id, content={"messages": [request.message], "response": response_text})
        db.add(report)
    else:
        report = task.report
        messages = list(report.content.get("messages", []))
        messages.append(request.message)
        report.content = {**report.content, "messages": messages, "response": response_text}

    task.status = "chat_completed"
    task.progress = 100

    db.commit()
    db.refresh(task)

    return ChatResponse(task_id=task.id, status=task.status, response=response_text)
>>>>>>> 507af811abd3d378346ae3614f91483d52ae1cd3
