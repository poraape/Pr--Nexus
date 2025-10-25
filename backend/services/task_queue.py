from __future__ import annotations

import json
from typing import Any, Dict

from backend.services.repositories import inline_executor
from backend.worker import AuditWorker

try:  # pragma: no cover - optional dependency
    import pika
except ImportError:  # pragma: no cover - optional dependency
    pika = None  # type: ignore[assignment]


class TaskPublisher:
    """Interface used to dispatch audit tasks to workers."""

    def publish(self, message: Dict[str, Any]) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class InlineTaskPublisher(TaskPublisher):
    """Execute tasks asynchronously using an in-process worker."""

    def __init__(self, worker: AuditWorker) -> None:
        self._worker = worker

    def publish(self, message: Dict[str, Any]) -> None:
        inline_executor.submit(self._worker.process_message, message)


class RabbitMQPublisher(TaskPublisher):  # pragma: no cover - requires RabbitMQ
    """Publish tasks to a RabbitMQ queue."""

    def __init__(self, url: str, queue_name: str = "audit_tasks") -> None:
        if pika is None:
            raise RuntimeError("pika library is required for RabbitMQ publishing")
        self._params = pika.URLParameters(url)
        self._queue_name = queue_name

    def publish(self, message: Dict[str, Any]) -> None:
        connection = pika.BlockingConnection(self._params)
        channel = connection.channel()
        channel.queue_declare(queue=self._queue_name, durable=True)
        channel.basic_publish(
            exchange="",
            routing_key=self._queue_name,
            body=json.dumps(message).encode("utf-8"),
            properties=pika.BasicProperties(delivery_mode=2),
        )
        connection.close()
