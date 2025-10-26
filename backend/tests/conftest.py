from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List

import os

import pytest

os.environ.setdefault("DISABLE_CONSULTANT_AGENT", "1")
os.environ.setdefault("LLM_PROVIDER", "gemini")
os.environ.setdefault("GEMINI_API_KEY", "test-key")

from backend.types import AgentPhase, AuditReport, ImportedDoc, ReportRepository, StatusRepository, StorageGateway


@pytest.fixture
def sample_csv(tmp_path: Path) -> Path:
    content = (
        "nfe_id,valor_total_nfe,produto_nome,produto_cfop,produto_ncm,produto_qtd,produto_valor_unit,produto_valor_total,"
        "emitente_uf,destinatario_uf,produto_cst_icms,produto_base_calculo_icms,produto_aliquota_icms,produto_valor_icms\n"
        "NFE123,1500,Produto A,5102,84719000,10,100,1000,SP,SP,00,1000,18,180\n"
    )
    path = tmp_path / "nota.csv"
    path.write_text(content, encoding="utf-8")
    return path


@pytest.fixture
def sample_csv_alt(tmp_path: Path) -> Path:
    content = (
        "nfe_id,valor_total_nfe,produto_nome,produto_cfop,produto_ncm,produto_qtd,produto_valor_unit,produto_valor_total,"
        "emitente_uf,destinatario_uf,produto_cst_icms,produto_base_calculo_icms,produto_aliquota_icms,produto_valor_icms\n"
        "NFE124,2000,Produto A,5102,84719000,5,120,600,SP,RJ,00,600,18,108\n"
    )
    path = tmp_path / "nota_alt.csv"
    path.write_text(content, encoding="utf-8")
    return path


class InMemoryStatusRepository(StatusRepository):
    def __init__(self) -> None:
        self.agent_updates: List[tuple[str, AgentPhase, str, Dict[str, Any] | None]] = []
        self.task_updates: List[tuple[str, str, str | None]] = []

    def update_agent_status(self, task_id: str, agent: AgentPhase, status: str, *, progress: Dict[str, Any] | None = None) -> None:
        self.agent_updates.append((task_id, agent, status, progress))

    def update_task_status(self, task_id: str, status: str, *, detail: str | None = None) -> None:
        self.task_updates.append((task_id, status, detail))


class InMemoryReportRepository(ReportRepository):
    def __init__(self) -> None:
        self.saved: Dict[str, AuditReport] = {}

    def save_report(self, task_id: str, report: AuditReport) -> None:
        self.saved[task_id] = report


class InMemoryStorage(StorageGateway):
    def __init__(self, mapping: Dict[str, Path]):
        self.mapping = mapping

    def load_files(self, references: Iterable[Dict[str, Any]]) -> List[str]:
        paths: List[str] = []
        for ref in references:
            identifier = ref["id"]
            paths.append(str(self.mapping[identifier]))
        return paths


@pytest.fixture
def repositories() -> Dict[str, Any]:
    return {
        "status": InMemoryStatusRepository(),
        "report": InMemoryReportRepository(),
    }
