from __future__ import annotations

from pathlib import Path

from backend.agents.accountant_agent import run_accounting_analysis
from backend.agents.classifier_agent import run_classification
from backend.agents.data_extractor_agent import extract_documents
from backend.agents.validator_agent import run_audit


def test_accountant_generates_summary(sample_csv: Path) -> None:
    docs = extract_documents([sample_csv])
    audited = run_audit(docs)
    classified = run_classification(audited)
    report = run_accounting_analysis(classified)
    assert report.summary is not None
    assert "Valor Total das NFes" in report.aggregatedMetrics
    assert report.accountingEntries is not None
    assert report.spedFile is not None
