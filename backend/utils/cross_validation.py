from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List

from backend.types import DeterministicCrossValidationResult, ImportedDoc, DeterministicDiscrepancy
from backend.utils.parsing import parse_safe_float

PRICE_VARIATION_THRESHOLD = 0.15


def run_deterministic_cross_validation(documents: Iterable[ImportedDoc]) -> List[DeterministicCrossValidationResult]:
    findings: List[DeterministicCrossValidationResult] = []
    valid_docs = [doc for doc in documents if doc.status != "error" and doc.status != "unsupported" and doc.data]
    if not valid_docs:
        return []

    items_by_product: Dict[str, List[Dict[str, object]]] = defaultdict(list)
    for doc in valid_docs:
        for item in doc.data or []:
            product_name = str(item.get("produto_nome") or "").strip()
            if not product_name:
                continue
            enriched = dict(item)
            enriched["docSource"] = {
                "name": doc.name,
                "internal_path": doc.meta.get("internal_path"),
            }
            items_by_product[product_name].append(enriched)

    for product, items in items_by_product.items():
        if len(items) < 2:
            continue

        ncm_values: Dict[str, List[Dict[str, object]]] = defaultdict(list)
        for item in items:
            ncm = str(item.get("produto_ncm") or "N/A")
            ncm_values[ncm].append(item)
        if len(ncm_values) > 1:
            keys = list(ncm_values.keys())
            reference = keys[0]
            discrepancies: List[DeterministicDiscrepancy] = []
            for other_key in keys[1:]:
                discrepancies.append(
                    DeterministicDiscrepancy(
                        valueA=reference,
                        docA=ncm_values[reference][0]["docSource"],
                        valueB=other_key,
                        docB=ncm_values[other_key][0]["docSource"],
                    )
                )
            findings.append(
                DeterministicCrossValidationResult(
                    comparisonKey=product,
                    attribute="NCM",
                    description=(
                        f'O produto "{product}" foi encontrado com múltiplos códigos NCM '
                        f"({', '.join(keys)}), o que pode levar a tributação inconsistente."
                    ),
                    discrepancies=discrepancies,
                    severity="ALERTA",
                )
            )

        min_price = float("inf")
        max_price = float("-inf")
        min_item = None
        max_item = None
        for item in items:
            unit_price = parse_safe_float(item.get("produto_valor_unit"))
            if unit_price <= 0:
                continue
            if unit_price < min_price:
                min_price = unit_price
                min_item = item
            if unit_price > max_price:
                max_price = unit_price
                max_item = item
        if min_item and max_item and max_price > min_price:
            variation = (max_price - min_price) / min_price
            if variation > PRICE_VARIATION_THRESHOLD:
                findings.append(
                    DeterministicCrossValidationResult(
                        comparisonKey=product,
                        attribute="Preço Unitário",
                        description=(
                            f"Variação de preço de {variation * 100:.0f}% detectada para o produto \"{product}\"."
                        ),
                        discrepancies=[
                            DeterministicDiscrepancy(
                                valueA=f"R$ {min_price:,.2f}",
                                docA=min_item["docSource"],
                                valueB=f"R$ {max_price:,.2f}",
                                docB=max_item["docSource"],
                            )
                        ],
                        severity="ALERTA",
                    )
                )

    return findings
