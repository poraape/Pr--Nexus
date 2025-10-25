from __future__ import annotations

from collections import Counter, defaultdict
from typing import Dict, List

from backend.types import AuditReport, AuditedDocument, ClassificationResult, AuditStatus

NCM_SECTOR_MAP: Dict[str, str] = {
    "84": "Máquinas e Equipamentos",
    "85": "Material Elétrico",
    "8471": "Tecnologia da Informação",
    "22": "Bebidas",
    "10": "Produtos de Moagem",
    "2106": "Preparações Alimentícias Diversas",
}


def _business_sector_from_ncm(ncm: str) -> str:
    if not ncm:
        return "Não Classificado"
    ncm = ncm.strip()
    ncm4 = ncm[:4]
    ncm2 = ncm[:2]
    return NCM_SECTOR_MAP.get(ncm4) or NCM_SECTOR_MAP.get(ncm2) or "Comércio Varejista/Atacadista"


def run_classification(report: AuditReport, corrections: Dict[str, str] | None = None) -> AuditReport:
    corrections = corrections or {}
    classified_docs: List[AuditedDocument] = []
    for audited_doc in report.documents:
        if audited_doc.status == AuditStatus.ERRO or not audited_doc.doc.data:
            classified_docs.append(audited_doc)
            continue

        if audited_doc.doc.name in corrections and audited_doc.classification:
            corrected = ClassificationResult(
                operationType=corrections[audited_doc.doc.name],
                businessSector=audited_doc.classification.businessSector,
                confidence=1.0,
            )
            classified_docs.append(
                AuditedDocument(
                    doc=audited_doc.doc,
                    status=audited_doc.status,
                    inconsistencies=audited_doc.inconsistencies,
                    score=audited_doc.score,
                    classification=corrected,
                )
            )
            continue

        counts = Counter()
        total_items = 0
        sector_scores: Dict[str, int] = defaultdict(int)
        for item in audited_doc.doc.data:
            cfop = str(item.get("produto_cfop") or "")
            ncm = str(item.get("produto_ncm") or "")
            if cfop:
                total_items += 1
                if cfop.startswith("1") or cfop.startswith("2"):
                    if cfop.startswith("12") or cfop.startswith("22"):
                        counts["devolucao"] += 1
                    elif cfop.startswith("14") or cfop.startswith("24"):
                        counts["compra"] += 1
                    elif cfop.startswith("13") or cfop.startswith("23"):
                        counts["servico"] += 1
                    elif cfop.startswith("155") or cfop.startswith("255"):
                        counts["transferencia"] += 1
                    else:
                        counts["compra"] += 1
                elif cfop.startswith("5") or cfop.startswith("6"):
                    if cfop.startswith("52") or cfop.startswith("62"):
                        counts["devolucao"] += 1
                    elif cfop.startswith("5933") or cfop.startswith("6933"):
                        counts["servico"] += 1
                    elif cfop.startswith("555") or cfop.startswith("655"):
                        counts["transferencia"] += 1
                    else:
                        counts["venda"] += 1
                else:
                    counts["outros"] += 1
            if ncm:
                sector_scores[_business_sector_from_ncm(ncm)] += 1

        if total_items == 0 or not counts:
            classified_docs.append(audited_doc)
            continue

        primary_type, type_count = counts.most_common(1)[0]
        primary_sector = max(sector_scores.items(), key=lambda item: item[1])[0] if sector_scores else "Não Classificado"
        operation_map = {
            "compra": "Compra",
            "venda": "Venda",
            "devolucao": "Devolução",
            "servico": "Serviço",
            "transferencia": "Transferência",
            "outros": "Outros",
        }
        classification = ClassificationResult(
            operationType=operation_map.get(primary_type, "Outros"),
            businessSector=primary_sector,
            confidence=type_count / total_items,
        )
        classified_docs.append(
            AuditedDocument(
                doc=audited_doc.doc,
                status=audited_doc.status,
                inconsistencies=audited_doc.inconsistencies,
                score=audited_doc.score,
                classification=classification,
            )
        )

    return AuditReport(
        documents=classified_docs,
        summary=report.summary,
        aggregatedMetrics=report.aggregatedMetrics,
        accountingEntries=report.accountingEntries,
        spedFile=report.spedFile,
        aiDrivenInsights=report.aiDrivenInsights,
        crossValidationResults=report.crossValidationResults,
        deterministicCrossValidation=report.deterministicCrossValidation,
    )
