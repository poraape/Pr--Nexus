from __future__ import annotations

from pathlib import Path

from backend.agents.data_extractor_agent import extract_documents
from backend.agents.validator_agent import run_audit
from backend.utils.rules_dictionary import INCONSISTENCIES


def test_validator_detects_inconsistencies(sample_csv_alt: Path) -> None:
    docs = extract_documents([sample_csv_alt])
    report = run_audit(docs)
    assert report.documents[0].status.name in {"ALERTA", "ERRO"}
    codes = {inc.code for inc in report.documents[0].inconsistencies}
    assert INCONSISTENCIES["CFOP_ESTADUAL_UF_INCOMPATIVEL"].code in codes
