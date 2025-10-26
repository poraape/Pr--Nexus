from __future__ import annotations

import unicodedata
from collections import defaultdict
from datetime import date
from typing import Dict, List

from backend.types import (
    AccountingEntry,
    AnalysisResult,
    AuditReport,
    AuditedDocument,
    SpedFile,
)
from backend.utils.parsing import parse_safe_float


def _format_currency(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


MOCK_ALIQUOTAS = {"IVA": 0.25}


_METRIC_LABELS = {
    "documents": "N\u00famero de Documentos V\u00e1lidos",
    "nfes": "Valor Total das NFes",
    "products": "Valor Total dos Produtos",
    "items": "Total de Itens Processados",
    "icms": "Valor Total de ICMS",
    "pis": "Valor Total de PIS",
    "cofins": "Valor Total de COFINS",
    "iss": "Valor Total de ISS",
    "iva": "Estimativa de IVA (Simulado)",
}

_METRIC_KEY_CANONICAL = {
    "Numero de Documentos Validos": _METRIC_LABELS["documents"],
    "Ngmero de Documentos Volidos": _METRIC_LABELS["documents"],
    _METRIC_LABELS["documents"]: _METRIC_LABELS["documents"],
    _METRIC_LABELS["nfes"]: _METRIC_LABELS["nfes"],
    _METRIC_LABELS["products"]: _METRIC_LABELS["products"],
    _METRIC_LABELS["items"]: _METRIC_LABELS["items"],
    _METRIC_LABELS["icms"]: _METRIC_LABELS["icms"],
    _METRIC_LABELS["pis"]: _METRIC_LABELS["pis"],
    _METRIC_LABELS["cofins"]: _METRIC_LABELS["cofins"],
    _METRIC_LABELS["iss"]: _METRIC_LABELS["iss"],
    _METRIC_LABELS["iva"]: _METRIC_LABELS["iva"],
}


def _normalize_metric_keys(metrics: Dict[str, object]) -> Dict[str, object]:
    normalized: Dict[str, object] = {}
    for key, value in metrics.items():
        ascii_key = unicodedata.normalize("NFKD", key).encode("ascii", "ignore").decode("ascii")
        canonical = _METRIC_KEY_CANONICAL.get(ascii_key, _METRIC_KEY_CANONICAL.get(key, key))
        normalized[canonical] = value
    return normalized


def _run_deterministic_accounting(report: AuditReport) -> Dict[str, object]:
    valid_docs = [doc for doc in report.documents if doc.status != doc.status.ERRO and doc.doc.data]
    metrics = {
        _METRIC_LABELS["documents"]: 0,
        _METRIC_LABELS["nfes"]: _format_currency(0),
        _METRIC_LABELS["products"]: _format_currency(0),
        _METRIC_LABELS["items"]: 0,
        _METRIC_LABELS["icms"]: _format_currency(0),
        _METRIC_LABELS["pis"]: _format_currency(0),
        _METRIC_LABELS["cofins"]: _format_currency(0),
        _METRIC_LABELS["iss"]: _format_currency(0),
        _METRIC_LABELS["iva"]: _format_currency(0),
    }
    if not valid_docs:
        return _normalize_metric_keys(metrics)

    all_items = [item for doc in valid_docs for item in (doc.doc.data or [])]
    unique_nfes: Dict[str, float] = {}
    for item in all_items:
        nfe_id = item.get("nfe_id")
        if not nfe_id:
            continue
        unique_nfes[str(nfe_id)] = parse_safe_float(item.get("valor_total_nfe"))

    totals = defaultdict(float)
    for item in all_items:
        totals["totalProductValue"] += parse_safe_float(item.get("produto_valor_total"))
        totals["totalICMS"] += parse_safe_float(item.get("produto_valor_icms"))
        totals["totalPIS"] += parse_safe_float(item.get("produto_valor_pis"))
        totals["totalCOFINS"] += parse_safe_float(item.get("produto_valor_cofins"))
        totals["totalISS"] += parse_safe_float(item.get("produto_valor_iss"))

    total_nfe_value = sum(unique_nfes.values())
    if total_nfe_value == 0 and totals["totalProductValue"] > 0:
        total_nfe_value = (
            totals["totalProductValue"]
            + totals["totalICMS"]
            + totals["totalPIS"]
            + totals["totalCOFINS"]
            + totals["totalISS"]
        )

    total_iva = (totals["totalPIS"] + totals["totalCOFINS"]) * MOCK_ALIQUOTAS["IVA"]

    metrics.update(
        {
            _METRIC_LABELS["documents"]: len(unique_nfes) or len(valid_docs),
            _METRIC_LABELS["nfes"]: _format_currency(total_nfe_value),
            _METRIC_LABELS["products"]: _format_currency(totals["totalProductValue"]),
            _METRIC_LABELS["items"]: len(all_items),
            _METRIC_LABELS["icms"]: _format_currency(totals["totalICMS"]),
            _METRIC_LABELS["pis"]: _format_currency(totals["totalPIS"]),
            _METRIC_LABELS["cofins"]: _format_currency(totals["totalCOFINS"]),
            _METRIC_LABELS["iss"]: _format_currency(totals["totalISS"]),
            _METRIC_LABELS["iva"]: _format_currency(total_iva),
        }
    )

    if total_nfe_value == 0 and all_items:
        metrics["Alerta de Qualidade"] = (
            "O valor total das NFes processadas é zero, indicando dados de origem inconsistentes."
        )

    return _normalize_metric_keys(metrics)


def _generate_accounting_entries(documents: List[AuditedDocument]) -> List[AccountingEntry]:
    entries: List[AccountingEntry] = []
    for doc in documents:
        if doc.status == doc.status.ERRO or not doc.classification or not doc.doc.data:
            continue
        total_nfe = parse_safe_float(doc.doc.data[0].get("valor_total_nfe"))
        total_products = sum(parse_safe_float(item.get("produto_valor_total")) for item in doc.doc.data)
        total_icms = sum(parse_safe_float(item.get("produto_valor_icms")) for item in doc.doc.data)
        if total_nfe == 0 and total_products == 0:
            continue
        op_type = doc.classification.operationType
        if op_type == "Compra":
            entries.append(AccountingEntry(docName=doc.doc.name, account="1.1.2 Estoques", type="D", value=total_products))
            if total_icms > 0:
                entries.append(AccountingEntry(docName=doc.doc.name, account="1.2.1 ICMS a Recuperar", type="D", value=total_icms))
            entries.append(AccountingEntry(docName=doc.doc.name, account="2.1.1 Fornecedores", type="C", value=total_nfe))
        elif op_type == "Venda":
            entries.append(AccountingEntry(docName=doc.doc.name, account="1.1.3 Clientes", type="D", value=total_nfe))
            entries.append(AccountingEntry(docName=doc.doc.name, account="4.1.1 Receita de Vendas", type="C", value=total_products))
            if total_icms > 0:
                entries.append(AccountingEntry(docName=doc.doc.name, account="4.2.1 ICMS sobre Vendas", type="D", value=total_icms))
                entries.append(AccountingEntry(docName=doc.doc.name, account="2.1.2 ICMS a Recolher", type="C", value=total_icms))
        elif op_type == "Devolução":
            cfop = str(doc.doc.data[0].get("produto_cfop") or "")
            if cfop.startswith("1") or cfop.startswith("2"):
                entries.append(AccountingEntry(docName=doc.doc.name, account="2.1.1 Fornecedores", type="D", value=total_nfe))
                if total_icms > 0:
                    entries.append(AccountingEntry(docName=doc.doc.name, account="1.2.1 ICMS a Recuperar", type="C", value=total_icms))
                entries.append(AccountingEntry(docName=doc.doc.name, account="1.1.2 Estoques", type="C", value=total_products))
            else:
                entries.append(AccountingEntry(docName=doc.doc.name, account="4.1.2 Devoluções de Vendas", type="D", value=total_products))
                if total_icms > 0:
                    entries.append(AccountingEntry(docName=doc.doc.name, account="2.1.2 ICMS a Recolher", type="D", value=total_icms))
                entries.append(AccountingEntry(docName=doc.doc.name, account="1.1.3 Clientes", type="C", value=total_nfe))
        elif op_type == "Serviço":
            cfop = str(doc.doc.data[0].get("produto_cfop") or "")
            if cfop.startswith("5") or cfop.startswith("6") or cfop.startswith("7"):
                entries.append(AccountingEntry(docName=doc.doc.name, account="1.1.3 Clientes", type="D", value=total_nfe))
                entries.append(AccountingEntry(docName=doc.doc.name, account="4.1.3 Receita de Serviços", type="C", value=total_nfe))
            else:
                entries.append(AccountingEntry(docName=doc.doc.name, account="3.1.1 Despesa com Serviços", type="D", value=total_nfe))
                entries.append(AccountingEntry(docName=doc.doc.name, account="2.1.1 Fornecedores", type="C", value=total_nfe))
        elif op_type == "Transferência":
            cfop = str(doc.doc.data[0].get("produto_cfop") or "")
            if cfop.startswith("5") or cfop.startswith("6"):
                entries.append(AccountingEntry(docName=doc.doc.name, account="3.1.2 Custo de Transferência", type="D", value=total_products))
                entries.append(AccountingEntry(docName=doc.doc.name, account="1.1.2 Estoques", type="C", value=total_products))
            else:
                entries.append(AccountingEntry(docName=doc.doc.name, account="1.1.2 Estoques", type="D", value=total_products))
                entries.append(AccountingEntry(docName=doc.doc.name, account="4.1.4 Receita de Transferência", type="C", value=total_products))
    return entries


def _generate_sped(report: AuditReport) -> SpedFile:
    today = date.today()
    data_ini = date(today.year, today.month, 1).strftime("%d%m%Y")
    next_month = date(today.year + (today.month // 12), ((today.month % 12) + 1), 1)
    data_fim = date(next_month.year, next_month.month, 1) - date.resolution
    data_fim_str = data_fim.strftime("%d%m%Y")
    lines = [
        f"|0000|017|0|{data_ini}|{data_fim_str}|Nexus QuantumI2A2|12345678000195||SP|||A|1|",
        "|0001|0|",
        "|C001|0|",
    ]
    record_counts = {"0000": 1, "0001": 1, "C001": 1}

    def count(tag: str) -> None:
        record_counts[tag] = record_counts.get(tag, 0) + 1

    valid_docs = [doc for doc in report.documents if doc.status != doc.status.ERRO and doc.doc.data]
    for doc in valid_docs:
        first_item = doc.doc.data[0]
        lines.append(
            f"|C100|{'0' if doc.classification and doc.classification.operationType == 'Compra' else '1'}|0||55|||"
            f"{parse_safe_float(first_item.get('valor_total_nfe')):.2f}|"
            + "|" * 12
        )
        count("C100")
        aggregator: Dict[str, Dict[str, float]] = defaultdict(lambda: {"vBC": 0.0, "vIcms": 0.0, "vOper": 0.0})
        for item in doc.doc.data:
            cst = str(item.get("produto_cst_icms") or "00")[:3]
            cfop = str(item.get("produto_cfop") or "0000")
            aliq = f"{parse_safe_float(item.get('produto_aliquota_icms')):.2f}".replace(".", ",")
            key = f"{cst}|{cfop}|{aliq}"
            bucket = aggregator[key]
            bucket["vBC"] += parse_safe_float(item.get("produto_base_calculo_icms"))
            bucket["vIcms"] += parse_safe_float(item.get("produto_valor_icms"))
            bucket["vOper"] += parse_safe_float(item.get("produto_valor_total"))
        for key, values in aggregator.items():
            cst, cfop, aliq = key.split("|")
            lines.append(
                f"|C190|{cst}|{cfop}|{aliq}|{values['vOper']:.2f}|{values['vBC']:.2f}|{values['vIcms']:.2f}||||"
            )
            count("C190")
        for index, item in enumerate(doc.doc.data, start=1):
            lines.append(
                f"|C170|{index}|{item.get('produto_nome', '')}|{parse_safe_float(item.get('produto_qtd')):.2f}|UN|"
                f"{parse_safe_float(item.get('produto_valor_total')):.2f}||{item.get('produto_cfop')}|{item.get('produto_cst_icms')}||||"
            )
            count("C170")

    lines.append(f"|C990|{1 + record_counts.get('C100', 0) + record_counts.get('C170', 0) + record_counts.get('C190', 0)}|")
    lines.append("|9001|0|")
    lines.append("|0990|2|")
    total_lines = len(lines) + 2
    lines.append(f"|9990|{total_lines - 1}|")
    lines.append(f"|9999|{total_lines}|")
    return SpedFile(filename=f"SPED-EFD-{today.isoformat()}.txt", content="\n".join(lines))


def run_accounting_analysis(report: AuditReport) -> AuditReport:
    metrics = _run_deterministic_accounting(report)
    entries = _generate_accounting_entries(report.documents)
    sped = _generate_sped(report)

    valid_items = [item for doc in report.documents if doc.status != doc.status.ERRO and doc.doc.data for item in doc.doc.data]
    if not valid_items:
        summary = AnalysisResult(
            title="Análise Fiscal Concluída",
            summary="Não foram encontrados dados válidos para gerar um resumo detalhado.",
            keyMetrics=[{"metric": key, "value": str(value), "insight": ""} for key, value in metrics.items()],
            actionableInsights=[
                "Verificar a causa dos erros nos documentos importados para permitir uma análise completa."
            ],
            strategicRecommendations=[
                "Implementar controles de qualidade nos arquivos enviados ao pipeline fiscal."
            ],
        )
        return AuditReport(
            documents=report.documents,
            summary=summary,
            aggregatedMetrics=metrics,
            accountingEntries=entries,
            spedFile=sped,
            aiDrivenInsights=report.aiDrivenInsights,
            crossValidationResults=report.crossValidationResults,
            deterministicCrossValidation=report.deterministicCrossValidation,
        )

    key_metrics = [
        {"metric": key, "value": str(value), "insight": ""} for key, value in metrics.items() if key != "Alerta de Qualidade"
    ]
    actionable = [
        "Monitorar os produtos com maior variação de preço para prevenir distorções fiscais.",
        "Revisar CFOPs utilizados para garantir alinhamento com operações reais.",
    ]
    if "Alerta de Qualidade" in metrics:
        actionable.append(metrics["Alerta de Qualidade"])
    strategic = [
        "Aprimorar a governança de cadastros fiscais para reduzir riscos tributários.",
        "Avaliar oportunidades de crédito com base na estimativa de IVA calculada.",
    ]
    summary = AnalysisResult(
        title="Panorama Fiscal Consolidado",
        summary=(
            "A análise determinística consolidou os principais indicadores fiscais da base processada, permitindo decisões "
            "mais assertivas sobre compliance e planejamento tributário."
        ),
        keyMetrics=key_metrics,
        actionableInsights=actionable,
        strategicRecommendations=strategic,
    )

    return AuditReport(
        documents=report.documents,
        summary=summary,
        aggregatedMetrics=metrics,
        accountingEntries=entries,
        spedFile=sped,
        aiDrivenInsights=report.aiDrivenInsights,
        crossValidationResults=report.crossValidationResults,
        deterministicCrossValidation=report.deterministicCrossValidation,
    )
