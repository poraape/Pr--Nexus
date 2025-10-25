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
