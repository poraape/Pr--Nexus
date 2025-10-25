from __future__ import annotations

from pathlib import Path

from backend.agents.classifier_agent import run_classification
from backend.agents.cross_validator_agent import run_cross_validation
from backend.agents.data_extractor_agent import extract_documents
from backend.agents.validator_agent import run_audit
from backend.types import AuditReport


def test_cross_validation_identifies_discrepancy(sample_csv: Path, sample_csv_alt: Path) -> None:
    docs = extract_documents([sample_csv, sample_csv_alt])
    audit = run_audit(docs)
    classified = run_classification(audit)
    report = run_cross_validation(classified)
    assert report.deterministicCrossValidation
    attributes = {finding.attribute for finding in report.deterministicCrossValidation}
    assert "NCM" in attributes or "Preço Unitário" in attributes
