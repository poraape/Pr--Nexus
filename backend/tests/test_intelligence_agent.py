from __future__ import annotations

from pathlib import Path

from backend.agents.classifier_agent import run_classification
from backend.agents.data_extractor_agent import extract_documents
from backend.agents.intelligence_agent import run_intelligence_analysis
from backend.agents.validator_agent import run_audit


def test_intelligence_generates_insights(sample_csv: Path, sample_csv_alt: Path) -> None:
    docs = extract_documents([sample_csv, sample_csv_alt])
    audit = run_audit(docs)
    classified = run_classification(audit)
    result = run_intelligence_analysis(classified)
    assert "aiDrivenInsights" in result
    assert isinstance(result["aiDrivenInsights"], list)
    assert isinstance(result["crossValidationResults"], list)
