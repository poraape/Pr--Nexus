from __future__ import annotations

import json
from typing import Any, Dict, Callable

from backend.services.repositories import inline_executor
from backend.worker import AuditWorker, MessageBroker

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

    def __init__(self, url: str, queue_name: str = "audit_tasks", *, queue: str | None = None) -> None:
        if pika is None:
            raise RuntimeError("pika library is required for RabbitMQ publishing")
        self._params = pika.URLParameters(url)
        self._queue_name = queue or queue_name

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


class RabbitMQConsumer(MessageBroker):  # pragma: no cover - requires RabbitMQ
    """Consume tasks from a RabbitMQ queue and dispatch them to the worker."""

    def __init__(self, url: str, queue_name: str = "audit_tasks", *, queue: str | None = None) -> None:
        if pika is None:
            raise RuntimeError("pika library is required for RabbitMQ consumption")
        self._params = pika.URLParameters(url)
        self._queue_name = queue or queue_name

    def consume(self, queue: str, callback: Callable[[Dict[str, Any] | str], None]) -> None:
        connection = pika.BlockingConnection(self._params)
        channel = connection.channel()
        channel.queue_declare(queue=queue, durable=True)

        def _on_message(ch, method, _properties, body) -> None:
            try:
                payload = body.decode("utf-8")
                callback(payload)
                ch.basic_ack(delivery_tag=method.delivery_tag)
            except Exception:
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                raise

        channel.basic_qos(prefetch_count=1)
        channel.basic_consume(queue=queue, on_message_callback=_on_message)
        try:
            channel.start_consuming()
        finally:
            channel.close()
            connection.close()
