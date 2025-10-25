from __future__ import annotations

from pathlib import Path

from backend.agents.classifier_agent import run_classification
from backend.agents.data_extractor_agent import extract_documents
from backend.agents.validator_agent import run_audit


def test_classifier_labels_operation(sample_csv: Path) -> None:
    docs = extract_documents([sample_csv])
    audit_report = run_audit(docs)
    classified = run_classification(audit_report)
    classification = classified.documents[0].classification
    assert classification is not None
    assert classification.operationType in {"Compra", "Venda"}
    assert classification.confidence > 0
