from __future__ import annotations

from typing import List

from backend.types import AuditReport, AuditedDocument, ImportedDoc, AuditStatus, Inconsistency
from backend.utils.rules_engine import run_fiscal_validation

SEVERITY_WEIGHTS = {
    "ERRO": 10,
    "ALERTA": 2,
    "INFO": 0,
}


def run_audit(docs: List[ImportedDoc]) -> AuditReport:
    audited_documents: List[AuditedDocument] = []
    for doc in docs:
        if doc.status in {"error", "unsupported"}:
            inconsistency = Inconsistency(
                code="IMPORT-FAIL",
                message=doc.error or "Falha na importação ou formato não suportado.",
                explanation=(
                    f'O arquivo "{doc.name}" não pôde ser processado corretamente. '
                    "Verifique a integridade e o formato do arquivo."
                ),
                severity="ERRO",
            )
            audited_documents.append(
                AuditedDocument(
                    doc=doc,
                    status=AuditStatus.ERRO,
                    inconsistencies=[inconsistency],
                    score=99,
                )
            )
            continue

        findings = []
        for item in doc.data or []:
            findings.extend(run_fiscal_validation(item))

        unique_incs = list({inc.code: inc for inc in findings}.values())
        status = AuditStatus.OK
        if any(inc.severity == "ERRO" for inc in unique_incs):
            status = AuditStatus.ERRO
        elif any(inc.severity == "ALERTA" for inc in unique_incs):
            status = AuditStatus.ALERTA

        score = sum(SEVERITY_WEIGHTS.get(inc.severity, 0) for inc in unique_incs)
        audited_documents.append(
            AuditedDocument(
                doc=doc,
                status=status,
                inconsistencies=unique_incs,
                score=score,
            )
        )

    return AuditReport(documents=audited_documents)
