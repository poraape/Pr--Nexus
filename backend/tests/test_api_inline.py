from __future__ import annotations

import json
import sys
import time
import types
from pathlib import Path
from typing import Dict, Generator, Iterable, List

import pytest
from fastapi.testclient import TestClient


class _StubConsultantAgentError(RuntimeError):
    """Exception raised by the stub consultant agent."""


class _StubConsultantAgent:
    """Minimal stand-in for the real consultant agent used in tests."""

    def __init__(self, *_args, **_kwargs) -> None:
        self._reports: Dict[str, Dict] = {}

    def index_report(self, session_id: str, report: Dict, *, metadata: Dict | None = None) -> None:
        payload = {"report": report}
        if metadata:
            payload["metadata"] = metadata
        self._reports[session_id] = payload

    def chat(self, session_id: str, question: str, history: List[Dict[str, str]]) -> Dict[str, str]:
        stored = self._reports.get(session_id, {})
        return {
            "answer": "stub-response",
            "question": question,
            "indexed": "yes" if stored else "no",
            "history": history,
        }

    def stream_chat(
        self, session_id: str, question: str, history: List[Dict[str, str]]
    ) -> Generator[str, None, Dict[str, str]]:
        yield json.dumps({"chunk": "stub"})
        return self.chat(session_id, question, history)

    def parse_response(self, text: str) -> Dict[str, str]:
        return {"raw": text}


class _StubLLMClient:
    """Simple LLM client that avoids external API calls during tests."""

    def __init__(self, *_args, **_kwargs) -> None:
        self.calls: List[str] = []

    def generate(self, prompt: str, **_kwargs) -> str:
        self.calls.append(prompt)
        return json.dumps({"message": "stub"})

    def stream(self, prompt: str, **_kwargs) -> Iterable[str]:
        self.calls.append(prompt)
        yield json.dumps({"delta": "stub"})


@pytest.fixture()
def inline_api_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterable[TestClient]:
    """Configure the FastAPI app to run fully inline for integration tests."""

    storage_dir = tmp_path / "storage"
    chroma_dir = tmp_path / "chroma"
    db_path = tmp_path / "app.db"

    monkeypatch.setenv("POSTGRES_DSN", f"sqlite+pysqlite:///{db_path}")
    monkeypatch.setenv("STORAGE_PATH", str(storage_dir))
    monkeypatch.setenv("CHROMA_PERSIST_DIRECTORY", str(chroma_dir))
    monkeypatch.setenv("TASK_DISPATCH_MODE", "inline")
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    # Replace heavy dependencies with lightweight stubs before the app is imported.
    for name in (
        "backend.core.config",
        "backend.database",
        "backend.database.models",
        "backend.services.repositories",
        "backend.services.storage",
        "backend.services.task_queue",
        "backend.worker",
        "backend.graph",
        "backend.api.endpoints",
        "backend.main",
    ):
        sys.modules.pop(name, None)

    sys.modules.pop("backend.agents.consultant_agent", None)
    consultant_module = types.ModuleType("backend.agents.consultant_agent")
    consultant_module.ConsultantAgent = _StubConsultantAgent
    consultant_module.ConsultantAgentError = _StubConsultantAgentError
    monkeypatch.setitem(sys.modules, "backend.agents.consultant_agent", consultant_module)

    sys.modules.pop("backend.services.llm_client", None)
    llm_module = types.ModuleType("backend.services.llm_client")
    llm_module.LLMClient = _StubLLMClient
    llm_module.LLMClientError = RuntimeError
    monkeypatch.setitem(sys.modules, "backend.services.llm_client", llm_module)

    from backend.main import app

    with TestClient(app) as client:
        yield client


def _wait_for_success(client: TestClient, task_id: str, timeout: float = 5.0) -> Dict[str, object]:
    """Poll the status endpoint until the pipeline finishes or timeout is reached."""

    deadline = time.monotonic() + timeout
    status_payload: Dict[str, object] | None = None
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/status/{task_id}")
        response.raise_for_status()
        status_payload = response.json()
        if status_payload.get("status") == "SUCCESS":
            return status_payload
        time.sleep(0.1)
    pytest.fail(f"Pipeline for task {task_id} did not finish in time")


def test_inline_upload_report_and_chat_flow(inline_api_client: TestClient) -> None:
    """End-to-end test covering upload, report retrieval and chat using inline mode."""

    csv_content = (
        "nfe_id,valor_total_nfe,produto_nome,produto_cfop,produto_ncm,produto_qtd,produto_valor_unit,produto_valor_total,"
        "emitente_uf,destinatario_uf,produto_cst_icms,produto_base_calculo_icms,produto_aliquota_icms,produto_valor_icms\n"
        "NFE123,1500,Produto A,5102,84719000,10,100,1000,SP,SP,00,1000,18,180\n"
    ).encode("utf-8")

    response = inline_api_client.post(
        "/api/v1/upload",
        files={"files": ("nota.csv", csv_content, "text/csv")},
    )
    assert response.status_code == 202
    payload = response.json()
    task_id = payload["task_id"]

    status_payload = _wait_for_success(inline_api_client, task_id)
    assert status_payload["task_id"] == task_id
    assert status_payload["status"] == "SUCCESS"

    report_response = inline_api_client.get(f"/api/v1/report/{task_id}")
    assert report_response.status_code == 200
    report_data = report_response.json()
    assert report_data["task_id"] == task_id
    assert "content" in report_data and isinstance(report_data["content"], dict)

    chat_payload = {
        "session_id": "session-123",
        "question": "Quais inconsistências foram encontradas?",
        "history": [],
        "report": report_data["content"],
    }
    chat_response = inline_api_client.post("/api/v1/chat", json=chat_payload)
    assert chat_response.status_code == 200
    chat_data = chat_response.json()
    assert chat_data["sessionId"] == "session-123"
    assert chat_data["message"]["answer"] == "stub-response"
