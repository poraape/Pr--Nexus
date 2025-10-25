from __future__ import annotations

import json
from typing import Any, Callable, Dict, Iterable, Optional

from backend.graph import AgentGraph, create_graph
from backend.types import GraphState, ReportRepository, StatusRepository, StorageGateway


class MessageBroker:  # pragma: no cover - interface for RabbitMQ clients
    def consume(self, queue: str, callback: Callable[[Dict[str, Any]], None]) -> None:
        raise NotImplementedError


class AuditWorker:
    def __init__(
        self,
        status_repository: StatusRepository,
        report_repository: ReportRepository,
        storage: StorageGateway,
        broker: Optional[MessageBroker] = None,
        graph: Optional[AgentGraph] = None,
        queue_name: str = "task_queue",
    ) -> None:
        self.status_repository = status_repository
        self.report_repository = report_repository
        self.storage = storage
        self.broker = broker
        self.queue_name = queue_name
        self.graph = graph or create_graph(status_repository=status_repository)

    def start(self) -> None:  # pragma: no cover - requires external services
        if not self.broker:
            raise RuntimeError("Message broker is required to start consumption")
        self.broker.consume(self.queue_name, self.process_message)

    def process_message(self, message: Dict[str, Any] | str) -> None:
        payload = json.loads(message) if isinstance(message, str) else message
        task_id = payload["task_id"]
        file_references = payload.get("files", [])
        try:
            self.status_repository.update_task_status(task_id, "RUNNING")
            file_paths = self.storage.load_files(file_references)
            state = GraphState(task_id=task_id, source_files=file_paths)
            result = self.graph.invoke(state)
            if not result.audit_report:
                raise RuntimeError("Pipeline não gerou relatório de auditoria")
            self.report_repository.save_report(task_id, result.audit_report)
            self.status_repository.update_task_status(task_id, "SUCCESS")
        except Exception as error:  # pragma: no cover - error path
            self.status_repository.update_task_status(task_id, "FAILURE", detail=str(error))
            raise
