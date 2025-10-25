from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional


class AuditStatus(str, Enum):
    OK = "OK"
    ALERTA = "ALERTA"
    ERRO = "ERRO"


class AgentPhase(str, Enum):
    OCR = "ocr"
    AUDITOR = "auditor"
    CLASSIFIER = "classifier"
    CROSS_VALIDATOR = "cross_validator"
    INTELLIGENCE = "intelligence"
    ACCOUNTANT = "accountant"


@dataclass
class ImportedDoc:
    kind: str
    name: str
    size: int
    status: str
    data: Optional[List[Dict[str, Any]]] = None
    text: Optional[str] = None
    error: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Inconsistency:
    code: str
    message: str
    explanation: str
    severity: str
    normativeBase: Optional[str] = None


@dataclass
class AuditedDocument:
    doc: ImportedDoc
    status: AuditStatus
    inconsistencies: List[Inconsistency]
    score: Optional[int] = None
    classification: Optional["ClassificationResult"] = None


@dataclass
class ClassificationResult:
    operationType: str
    businessSector: str
    confidence: float


@dataclass
class DeterministicDiscrepancy:
    valueA: str | float | int
    docA: Dict[str, Any]
    valueB: str | float | int
    docB: Dict[str, Any]


@dataclass
class DeterministicCrossValidationResult:
    comparisonKey: str
    attribute: str
    description: str
    discrepancies: List[DeterministicDiscrepancy]
    severity: str


@dataclass
class AIDrivenInsight:
    category: str
    description: str
    severity: str
    evidence: List[str]


@dataclass
class CrossValidationResult:
    attribute: str
    observation: str
    documents: List[Dict[str, Any]]


@dataclass
class AccountingEntry:
    docName: str
    account: str
    type: str
    value: float


@dataclass
class SpedFile:
    filename: str
    content: str


@dataclass
class AnalysisResult:
    title: str
    summary: str
    keyMetrics: List[Dict[str, str]]
    actionableInsights: List[str]
    strategicRecommendations: List[str]


@dataclass
class AuditReport:
    documents: List[AuditedDocument]
    summary: Optional[AnalysisResult] = None
    aggregatedMetrics: Optional[Dict[str, Any]] = None
    accountingEntries: Optional[List[AccountingEntry]] = None
    spedFile: Optional[SpedFile] = None
    aiDrivenInsights: Optional[List[AIDrivenInsight]] = None
    crossValidationResults: Optional[List[CrossValidationResult]] = None
    deterministicCrossValidation: Optional[List[DeterministicCrossValidationResult]] = None


@dataclass
class GraphState:
    task_id: str
    source_files: List[str] = field(default_factory=list)
    imported_docs: List[ImportedDoc] = field(default_factory=list)
    audit_report: Optional[AuditReport] = None
    errors: List[str] = field(default_factory=list)

    def copy(self) -> "GraphState":
        return GraphState(
            task_id=self.task_id,
            source_files=list(self.source_files),
            imported_docs=list(self.imported_docs),
            audit_report=self.audit_report,
            errors=list(self.errors),
        )


class StatusRepository:
    """Minimal repository protocol used by callbacks and worker."""

    def update_agent_status(
        self,
        task_id: str,
        agent: AgentPhase,
        status: str,
        *,
        progress: Optional[Dict[str, Any]] = None,
    ) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def update_task_status(self, task_id: str, status: str, *, detail: Optional[str] = None) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class ReportRepository:
    """Interface for persisting generated reports."""

    def save_report(self, task_id: str, report: AuditReport) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class StorageGateway:
    """Abstraction over the storage layer used by the worker."""

    def load_files(self, references: Iterable[Dict[str, Any]]) -> List[str]:  # pragma: no cover - interface
        raise NotImplementedError
