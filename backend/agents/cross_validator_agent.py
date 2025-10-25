from __future__ import annotations

from typing import List

from backend.types import AuditReport
from backend.utils.cross_validation import run_deterministic_cross_validation


def run_cross_validation(report: AuditReport) -> AuditReport:
    findings = run_deterministic_cross_validation(doc.doc for doc in report.documents)
    return AuditReport(
        documents=report.documents,
        summary=report.summary,
        aggregatedMetrics=report.aggregatedMetrics,
        accountingEntries=report.accountingEntries,
        spedFile=report.spedFile,
        aiDrivenInsights=report.aiDrivenInsights,
        crossValidationResults=report.crossValidationResults,
        deterministicCrossValidation=findings,
    )
