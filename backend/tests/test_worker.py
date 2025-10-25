from __future__ import annotations

from pathlib import Path

from backend.tests.conftest import InMemoryStorage
from backend.worker import AuditWorker


def test_worker_process_message(sample_csv: Path, repositories) -> None:
    storage = InMemoryStorage({"file-1": sample_csv})
    worker = AuditWorker(
        status_repository=repositories["status"],
        report_repository=repositories["report"],
        storage=storage,
    )
    worker.process_message({"task_id": "task-123", "files": [{"id": "file-1"}]})
    assert repositories["status"].task_updates[-1] == ("task-123", "SUCCESS")
    assert "task-123" in repositories["report"].saved
