from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from backend.database import SessionLocal, session_scope
from backend.database.models import Report, Task
from backend.types import AgentPhase, AuditReport, ReportRepository, StatusRepository
from backend.utils.serialization import to_serializable


_AGENT_STEP_HINTS: Dict[AgentPhase, str] = {
    AgentPhase.OCR: "Processando arquivos e extraindo dados...",
    AgentPhase.AUDITOR: "Executando regras fiscais...",
    AgentPhase.CLASSIFIER: "Classificando documentos...",
    AgentPhase.CROSS_VALIDATOR: "Validando consistência determinística...",
    AgentPhase.INTELLIGENCE: "Gerando insights com IA...",
    AgentPhase.ACCOUNTANT: "Preparando visão contábil...",
}


class SQLAlchemyStatusRepository(StatusRepository):
    """Persist task and agent status information using SQLAlchemy sessions."""

    def update_agent_status(
        self,
        task_id: str,
        agent: AgentPhase,
        status: str,
        *,
        progress: Optional[Dict[str, Any]] = None,
    ) -> None:
        with session_scope() as session:
            task = session.get(Task, uuid.UUID(task_id))
            if task is None:
                return

            agent_state = dict(task.agent_status or {})
            state_payload: Dict[str, Any] = agent_state.get(agent.value, {})
            state_payload["status"] = status.lower()
            step_hint = _AGENT_STEP_HINTS.get(agent)
            if step_hint and status.lower() == "running":
                progress = progress or {}
                progress.setdefault("step", step_hint)
            if progress:
                state_payload["progress"] = {**state_payload.get("progress", {}), **progress}
            agent_state[agent.value] = state_payload
            task.agent_status = agent_state

            total_agents = len(agent_state)
            completed = sum(1 for payload in agent_state.values() if payload.get("status") == "completed")
            task.progress = int((completed / total_agents) * 100) if total_agents else 0

    def update_task_status(self, task_id: str, status: str, *, detail: Optional[str] = None) -> None:
        normalized = status.upper()
        with session_scope() as session:
            task = session.get(Task, uuid.UUID(task_id))
            if task is None:
                return
            task.status = normalized
            if detail:
                task.error_message = detail[:512]
            if normalized == "FAILURE" and detail:
                # propagate failure message to running agent if any
                for payload in task.agent_status.values():
                    if payload.get("status") == "running":
                        payload["status"] = "error"
                        payload.setdefault("progress", {})["step"] = detail


-class SQLAlchemyReportRepository(ReportRepository):
+class SQLAlchemyReportRepository(ReportRepository):
     """Persist generated reports to the relational database."""
 
     def __init__(self, session_factory: Callable[[], Session] = SessionLocal) -> None:
         self._session_factory = session_factory
 
     def save_report(self, task_id: str, report: AuditReport) -> None:
-        # TODO: implement persistence logic
-        raise NotImplementedError
+        payload = to_serializable(report)
+        with session_scope() as session:
+            task = session.get(Task, uuid.UUID(task_id))
+            if task is None:
+                raise ValueError(f"Task {task_id} not found while saving report")
+
+            if task.report is None:
+                task.report = Report(task_id=task.id, content=payload)
+            else:
+                task.report.content = payload
+
+
+class InlineTaskExecutor:
+    """Utility that runs callables on a background thread."""
+
+    def __init__(self) -> None:
+        self._executor = ThreadPoolExecutor(max_workers=2)
+
+    def submit(self, func: Callable[..., None], *args: Any, **kwargs: Any) -> None:
+        self._executor.submit(func, *args, **kwargs)
+
+
+inline_executor = InlineTaskExecutor()
