from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from backend.types import AuditReport, AIDrivenInsight, CrossValidationResult
from backend.utils.cross_validation import run_deterministic_cross_validation, PRICE_VARIATION_THRESHOLD
from backend.utils.parsing import parse_safe_float


def run_intelligence_analysis(report: AuditReport) -> Dict[str, List[object]]:
    valid_docs = [doc for doc in report.documents if doc.status != doc.status.ERRO and doc.doc.data]
    if len(valid_docs) < 2:
        return {"aiDrivenInsights": [], "crossValidationResults": []}

    deterministic = run_deterministic_cross_validation(doc.doc for doc in valid_docs)
    cross_results: List[CrossValidationResult] = []
    for finding in deterministic:
        documents = []
        for discrepancy in finding.discrepancies:
            documents.append({"name": discrepancy.docA["name"], "value": discrepancy.valueA})
            documents.append({"name": discrepancy.docB["name"], "value": discrepancy.valueB})
        cross_results.append(
            CrossValidationResult(
                attribute=finding.attribute,
                observation=finding.description,
                documents=documents,
            )
        )

    price_map: Dict[str, List[float]] = defaultdict(list)
    for doc in valid_docs:
        for item in doc.doc.data or []:
            name = str(item.get("produto_nome") or "").strip()
            if not name:
                continue
            price_map[name].append(parse_safe_float(item.get("produto_valor_unit")))

    insights: List[AIDrivenInsight] = []
    for product, prices in price_map.items():
        filtered = [price for price in prices if price > 0]
        if len(filtered) < 2:
            continue
        min_price = min(filtered)
        max_price = max(filtered)
        if min_price <= 0:
            continue
        variation = (max_price - min_price) / min_price
        if variation > PRICE_VARIATION_THRESHOLD:
            insights.append(
                AIDrivenInsight(
                    category="Risco Fiscal",
                    description=(
                        f"O produto {product} apresenta variação de preço unitário de {variation * 100:.0f}%. "
                        "Revisar políticas comerciais e cadastros fiscais."
                    ),
                    severity="MÉDIA" if variation < 0.5 else "ALTA",
                    evidence=[product],
                )
            )

    return {"aiDrivenInsights": insights, "crossValidationResults": cross_results}
