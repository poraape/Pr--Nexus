from __future__ import annotations

import logging
import sys

from backend.core.config import get_settings
from backend.services.repositories import SQLAlchemyReportRepository, SQLAlchemyStatusRepository
from backend.services.storage import FileStorage
from backend.services.task_queue import RabbitMQConsumer
from backend.worker import AuditWorker

logger = logging.getLogger(__name__)


def main() -> int:
    """Bootstraps the audit worker to consume tasks from RabbitMQ."""

    settings = get_settings()
    if settings.task_dispatch_mode != "rabbitmq":
        logger.error(
            "TASK_DISPATCH_MODE must be set to 'rabbitmq' to run the external worker. "
            "Current value: %s",
            settings.task_dispatch_mode,
        )
        return 1

    status_repository = SQLAlchemyStatusRepository()
    report_repository = SQLAlchemyReportRepository()
    storage = FileStorage(settings.storage_path)

    worker = AuditWorker(
        status_repository=status_repository,
        report_repository=report_repository,
        storage=storage,
        broker=RabbitMQConsumer(settings.rabbitmq_url, queue_name=settings.rabbitmq_queue),
        queue_name=settings.rabbitmq_queue,
    )

    logger.info("Starting audit worker. Queue=%s Broker=%s", settings.rabbitmq_queue, settings.rabbitmq_url)
    worker.start()
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    sys.exit(main())
