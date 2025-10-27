from __future__ import annotations

import csv
import io
import json
import logging
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from backend.types import ImportedDoc
from backend.utils.parsing import parse_safe_float

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[int, int], None]
SUPPORTED_KINDS = {
    "xml": "NFE_XML",
    "csv": "CSV",
    "json": "CSV",
    "pdf": "PDF",
    "ocr": "OCR_TEXT",
}

BRAZILIAN_STATES = {
    "AC",
    "AL",
    "AM",
    "AP",
    "BA",
    "CE",
    "DF",
    "ES",
    "GO",
    "MA",
    "MG",
    "MS",
    "MT",
    "PA",
    "PB",
    "PE",
    "PI",
    "PR",
    "RJ",
    "RN",
    "RO",
    "RR",
    "RS",
    "SC",
    "SE",
    "SP",
    "TO",
}

CSV_FIELD_ALIASES: Dict[str, List[str]] = {
    "nfe_id": [
        "nfe id",
        "nfe",
        "id nfe",
        "chave",
        "chave nf",
        "chave acesso",
        "chave de acesso",
        "numero nf",
        "numero nfe",
        "numero nota",
        "chave nota",
        "access key",
    ],
    "data_emissao": [
        "data emissao",
        "data emissão",
        "data nf",
        "data nota",
        "emissao",
        "emissão",
        "emissao nf",
        "issue date",
    ],
    "valor_total_nfe": [
        "valor total nfe",
        "valor total nota",
        "valor nf",
        "valor da nota",
        "total nf",
        "valor total documento",
        "total nota fiscal",
        "valor nf-e",
        "total nota",
    ],
    "emitente_nome": [
        "nome emitente",
        "emitente nome",
        "razao social emitente",
        "emitente razao social",
        "emitente razao",
        "empresa emitente",
        "fornecedor nome",
        "fornecedor",
        "supplier name",
    ],
    "emitente_cnpj": [
        "cnpj emitente",
        "emitente cnpj",
        "cnpj fornecedor",
        "cnpj remetente",
        "emit cnpj",
    ],
    "emitente_uf": [
        "uf emitente",
        "estado emitente",
        "uf origem",
        "origem uf",
    ],
    "destinatario_nome": [
        "nome destinatario",
        "destinatario nome",
        "razao social destinatario",
        "destinatario razao",
        "nome cliente",
        "cliente nome",
        "comprador nome",
        "comprador",
        "cliente",
    ],
    "destinatario_cnpj": [
        "cnpj destinatario",
        "destinatario cnpj",
        "cnpj cliente",
        "cnpj comprador",
        "cnpj destinatário",
    ],
    "destinatario_uf": [
        "uf destinatario",
        "estado destinatario",
        "uf destino",
        "destino uf",
    ],
    "produto_nome": [
        "descricao do produto",
        "descrição do produto",
        "descricao produto",
        "descricao item",
        "item",
        "produto",
        "servico",
        "descricao",
        "produto descricao",
        "produto servico",
        "item descricao",
    ],
    "produto_ncm": [
        "ncm",
        "codigo ncm",
        "codigo ncm/sh",
        "ncm/sh",
        "ncm codigo",
        "ncm sh",
    ],
    "produto_cfop": [
        "cfop",
        "codigo cfop",
        "cfop codigo",
    ],
    "produto_qtd": [
        "quantidade",
        "qtd",
        "qtde",
        "qtd produto",
        "quant",
        "quantidade produto",
        "quantidade item",
        "qty",
    ],
    "produto_valor_unit": [
        "valor unitario",
        "valor unitário",
        "preco unitario",
        "preço unitario",
        "valor unit",
        "valor unit",
        "unit price",
        "valor unitario item",
    ],
    "produto_valor_total": [
        "valor total item",
        "valor total produto",
        "valor total servico",
        "valor total linha",
        "valor total",
        "total item",
        "valor item",
        "valor total mercadoria",
    ],
    "produto_cst_icms": [
        "cst icms",
        "situacao tributaria icms",
        "cst",
        "cst produto",
        "cst icms produto",
    ],
    "produto_base_calculo_icms": [
        "base calculo icms",
        "base de calculo icms",
        "base icms",
        "base calculo",
    ],
    "produto_aliquota_icms": [
        "aliquota icms",
        "alíquota icms",
        "aliq icms",
        "aliquota",
    ],
    "produto_valor_icms": [
        "valor icms",
        "icms valor",
        "total icms",
    ],
    "produto_cst_pis": [
        "cst pis",
        "situacao tributaria pis",
        "pis cst",
    ],
    "produto_valor_pis": [
        "valor pis",
        "pis valor",
        "total pis",
    ],
    "produto_cst_cofins": [
        "cst cofins",
        "situacao tributaria cofins",
        "cofins cst",
    ],
    "produto_valor_cofins": [
        "valor cofins",
        "cofins valor",
        "total cofins",
    ],
    "produto_valor_iss": [
        "valor iss",
        "iss valor",
        "total iss",
        "issqn",
    ],
}

CSV_NUMERIC_FIELDS = {
    "valor_total_nfe",
    "produto_qtd",
    "produto_valor_unit",
    "produto_valor_total",
    "produto_base_calculo_icms",
    "produto_aliquota_icms",
    "produto_valor_icms",
    "produto_valor_pis",
    "produto_valor_cofins",
    "produto_valor_iss",
}


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    no_accents = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    cleaned = re.sub(r"[^a-z0-9]+", " ", no_accents.lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


def _score_header_match(normalized_header: str, aliases: List[str]) -> float:
    if not normalized_header:
        return 0.0
    header_tokens = set(normalized_header.split())
    best_score = 0.0
    for alias in aliases:
        alias_tokens = set(alias.split())
        if not alias_tokens:
            continue
        if normalized_header == alias:
            return 1.0
        token_overlap = len(header_tokens & alias_tokens) / len(alias_tokens)
        if alias in normalized_header:
            best_score = max(best_score, 0.95)
            continue
        if not header_tokens:
            continue
        if token_overlap:
            overlap_count = len(header_tokens & alias_tokens)
            coverage = overlap_count / len(alias_tokens)
            header_coverage = overlap_count / len(header_tokens)
            missing_ratio = 1.0 - coverage
            score = coverage * 0.7 + header_coverage * 0.3 - (missing_ratio * 0.4)
            best_score = max(best_score, max(score, 0.0))
    return best_score


def _detect_csv_delimiter(sample_text: str) -> str:
    sample = "\n".join(sample_text.splitlines()[:50])
    sniffer = csv.Sniffer()
    try:
        dialect = sniffer.sniff(sample, delimiters=",;|\t")
        return dialect.delimiter
    except csv.Error:
        counters = Counter({
            ",": sample.count(","),
            ";": sample.count(";"),
            "\t": sample.count("\t"),
            "|": sample.count("|"),
        })
        delimiter, occurrences = counters.most_common(1)[0]
        if occurrences == 0:
            return ","
        return delimiter


def _sanitize_fieldnames(fieldnames: List[str]) -> Tuple[List[str], Dict[str, str]]:
    sanitized: List[str] = []
    display_map: Dict[str, str] = {}
    counts: Dict[str, int] = {}
    for raw in fieldnames:
        if raw is None:
            continue
        cleaned = raw.strip()
        if not cleaned:
            continue
        count = counts.get(cleaned, 0)
        alias = cleaned if count == 0 else f"{cleaned}__{count}"
        counts[cleaned] = count + 1
        sanitized.append(alias)
        display_map[alias] = cleaned
    return sanitized, display_map


def _decode_csv_bytes(data: bytes) -> str:
    encodings = ["utf-8-sig", "utf-16", "utf-8", "latin-1"]
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def _read_csv_rows(text: str) -> Tuple[List[Dict[str, str]], Dict[str, str]]:
    if not text:
        return [], {}
    delimiter = _detect_csv_delimiter(text)
    buffer = io.StringIO(text)
    reader = csv.DictReader(buffer, delimiter=delimiter, quotechar='"', skipinitialspace=True)
    raw_fieldnames = reader.fieldnames or []
    sanitized_fieldnames, display_map = _sanitize_fieldnames(raw_fieldnames)
    reader.fieldnames = sanitized_fieldnames
    rows: List[Dict[str, str]] = []
    for raw_row in reader:
        row: Dict[str, str] = {}
        for key, value in raw_row.items():
            if key is None:
                continue
            if isinstance(value, str):
                value = value.strip()
            row[key] = value
        if any((isinstance(v, str) and v) or (v not in (None, "")) for v in row.values()):
            rows.append(row)
    return rows, display_map


def _prepare_generic_rows(rows: List[Dict[str, str]]) -> Tuple[List[Dict[str, str]], Dict[str, str]]:
    if not rows:
        return [], {}
    ordered_columns: List[str] = []
    for row in rows:
        for key in row.keys():
            if key and key not in ordered_columns:
                ordered_columns.append(key)
    sanitized, display_map = _sanitize_fieldnames(ordered_columns)
    key_map = {orig: alias for orig, alias in zip(ordered_columns, sanitized)}
    normalized_rows: List[Dict[str, str]] = []
    for row in rows:
        normalized_row: Dict[str, str] = {}
        for key, value in row.items():
            if key not in key_map:
                continue
            alias = key_map[key]
            if isinstance(value, str):
                value = value.strip()
            normalized_row[alias] = value
        normalized_rows.append(normalized_row)
    return normalized_rows, display_map


def _digits(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(ch for ch in value if ch.isdigit())


def _score_numeric_column(values: List[Optional[str]], header: str) -> float:
    numeric = 0
    total = 0
    for value in values:
        if value in (None, ""):
            continue
        total += 1
        parsed = parse_safe_float(value)
        if parsed != 0.0 or (isinstance(value, str) and any(ch.isdigit() for ch in value)):
            numeric += 1
    if total == 0:
        return 0.0
    base_score = numeric / total
    if "total" in header:
        base_score += 0.2
    if "unit" in header or "unitario" in header:
        base_score += 0.1
    if "qtd" in header or "quant" in header:
        base_score += 0.1
    return min(base_score, 1.0)


def _score_date_column(values: List[Optional[str]]) -> float:
    pattern = re.compile(r"\b(\d{2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2})\b")
    matches = 0
    total = 0
    for value in values:
        if not value:
            continue
        total += 1
        if isinstance(value, str) and pattern.search(value):
            matches += 1
    if total == 0:
        return 0.0
    return matches / total


def _score_cfop_column(values: List[Optional[str]]) -> float:
    matches = 0
    total = 0
    for value in values:
        if not value:
            continue
        total += 1
        digits = _digits(str(value))
        if len(digits) == 4:
            matches += 1
    if total == 0:
        return 0.0
    return matches / total


def _score_ncm_column(values: List[Optional[str]]) -> float:
    matches = 0
    total = 0
    for value in values:
        if not value:
            continue
        total += 1
        digits = _digits(str(value))
        if len(digits) in {8, 10}:
            matches += 1
    if total == 0:
        return 0.0
    return matches / total


def _score_cnpj_column(values: List[Optional[str]]) -> float:
    matches = 0
    total = 0
    for value in values:
        if not value:
            continue
        total += 1
        digits = _digits(str(value))
        if len(digits) >= 14:
            matches += 1
    if total == 0:
        return 0.0
    return matches / total


def _score_uf_column(values: List[Optional[str]]) -> float:
    matches = 0
    total = 0
    for value in values:
        if not value:
            continue
        total += 1
        if isinstance(value, str) and value.strip().upper() in BRAZILIAN_STATES:
            matches += 1
    if total == 0:
        return 0.0
    return matches / total


def _score_access_key_column(values: List[Optional[str]]) -> float:
    matches = 0
    total = 0
    for value in values:
        if not value:
            continue
        total += 1
        digits = _digits(str(value))
        if len(digits) in {44, 43, 45}:
            matches += 1
    if total == 0:
        return 0.0
    return matches / total


def _infer_column_mapping(
    rows: List[Dict[str, str]],
    display_map: Dict[str, str],
) -> Tuple[Dict[str, str], Dict[str, Dict[str, object]]]:
    if not rows:
        return {}, {}

    columns = list(display_map.keys())
    normalized_headers = {column: _normalize_text(display_map.get(column, column)) for column in columns}
    mapping: Dict[str, str] = {}
    diagnostics: Dict[str, Dict[str, object]] = {}
    used_columns: set[str] = set()

    for field, aliases in CSV_FIELD_ALIASES.items():
        best_column: Optional[str] = None
        best_score = 0.0
        for column in columns:
            if column in used_columns:
                continue
            score = _score_header_match(normalized_headers.get(column, ""), aliases)
            if score > best_score:
                best_column = column
                best_score = score
        if best_column and best_score >= 0.65:
            mapping[field] = best_column
            used_columns.add(best_column)
            diagnostics[field] = {
                "column": display_map.get(best_column, best_column),
                "score": round(best_score, 3),
                "matched_by": "alias",
            }

    def collect_values(column: str) -> List[Optional[str]]:
        return [row.get(column) for row in rows]

    # Value-driven inference for missing fields
    inference_rules: Dict[str, Callable[[str, List[Optional[str]]], float]] = {
        "nfe_id": lambda header, values: (_score_access_key_column(values) * 0.7)
        + (0.3 if "chave" in header or "nfe" in header else 0.0),
        "data_emissao": lambda header, values: _score_date_column(values),
        "valor_total_nfe": lambda header, values: _score_numeric_column(values, header + " total" if "nota" in header or "nf" in header else header),
        "produto_valor_total": lambda header, values: _score_numeric_column(values, header + " item" if "item" in header or "produto" in header else header),
        "produto_valor_unit": lambda header, values: _score_numeric_column(values, header + " unit"),
        "produto_qtd": lambda header, values: _score_numeric_column(values, header + " qtd"),
        "produto_cfop": lambda header, values: _score_cfop_column(values),
        "produto_ncm": lambda header, values: _score_ncm_column(values),
        "emitente_cnpj": lambda header, values: _score_cnpj_column(values),
        "destinatario_cnpj": lambda header, values: _score_cnpj_column(values),
        "emitente_uf": lambda header, values: _score_uf_column(values),
        "destinatario_uf": lambda header, values: _score_uf_column(values),
    }

    for field, scorer in inference_rules.items():
        if field in mapping:
            continue
        best_column = None
        best_score = 0.0
        for column in columns:
            if column in used_columns:
                continue
            header = normalized_headers.get(column, "")
            values = collect_values(column)
            score = scorer(header, values)
            if score > best_score:
                best_score = score
                best_column = column
        if best_column and best_score >= 0.55:
            mapping[field] = best_column
            used_columns.add(best_column)
            diagnostics[field] = {
                "column": display_map.get(best_column, best_column),
                "score": round(best_score, 3),
                "matched_by": "values",
            }

    return mapping, diagnostics


def _guess_textual_value(row: Dict[str, str], candidates: List[str]) -> Optional[str]:
    for column in candidates:
        value = row.get(column)
        if isinstance(value, str) and any(ch.isalpha() for ch in value):
            return value
    return None


def _aggregate_totals(rows: List[Dict[str, str]], mapping: Dict[str, str]) -> Dict[str, float]:
    totals: Dict[str, float] = {}
    nfe_column = mapping.get("nfe_id")
    item_total_column = mapping.get("produto_valor_total")
    value_total_column = mapping.get("valor_total_nfe")
    if nfe_column and item_total_column:
        for row in rows:
            nfe_id = (row.get(nfe_column) or "").strip()
            if not nfe_id:
                continue
            totals[nfe_id] = totals.get(nfe_id, 0.0) + parse_safe_float(row.get(item_total_column))
    if not totals and nfe_column and value_total_column:
        for row in rows:
            nfe_id = (row.get(nfe_column) or "").strip()
            if not nfe_id:
                continue
            value = parse_safe_float(row.get(value_total_column))
            if value:
                totals[nfe_id] = max(totals.get(nfe_id, 0.0), value)
    return totals


def _convert_tabular_rows(
    rows: List[Dict[str, str]],
    display_map: Dict[str, str],
    source_name: str,
) -> Tuple[List[Dict[str, object]], Dict[str, object]]:
    if not rows:
        return [], {
            "source": source_name,
            "row_count": 0,
            "column_mapping": {},
            "has_structured_table": False,
            "has_text_only": False,
        }

    mapping, diagnostics = _infer_column_mapping(rows, display_map)
    totals_by_nfe = _aggregate_totals(rows, mapping)
    columns = list(display_map.keys())
    unused_columns = [display_map.get(column, column) for column in columns if column not in mapping.values()]
    detection_confidence = {field: info["score"] for field, info in diagnostics.items()}

    result: List[Dict[str, object]] = []
    textual_candidates = [column for column in columns if column not in mapping.values()]

    for row in rows:
        entry: Dict[str, object] = {
            "nfe_id": (row.get(mapping.get("nfe_id", "")) or None),
            "data_emissao": (row.get(mapping.get("data_emissao", "")) or None),
            "valor_total_nfe": parse_safe_float(row.get(mapping.get("valor_total_nfe", ""))),
            "emitente_nome": row.get(mapping.get("emitente_nome", "")) or None,
            "emitente_cnpj": _mask_cnpj(row.get(mapping.get("emitente_cnpj", ""))),
            "emitente_uf": (row.get(mapping.get("emitente_uf", "")) or None),
            "destinatario_nome": row.get(mapping.get("destinatario_nome", "")) or None,
            "destinatario_cnpj": _mask_cnpj(row.get(mapping.get("destinatario_cnpj", ""))),
            "destinatario_uf": (row.get(mapping.get("destinatario_uf", "")) or None),
            "produto_nome": row.get(mapping.get("produto_nome", "")) or None,
            "produto_ncm": row.get(mapping.get("produto_ncm", "")) or None,
            "produto_cfop": row.get(mapping.get("produto_cfop", "")) or None,
            "produto_cst_icms": row.get(mapping.get("produto_cst_icms", "")) or None,
            "produto_base_calculo_icms": parse_safe_float(row.get(mapping.get("produto_base_calculo_icms", ""))),
            "produto_aliquota_icms": parse_safe_float(row.get(mapping.get("produto_aliquota_icms", ""))),
            "produto_valor_icms": parse_safe_float(row.get(mapping.get("produto_valor_icms", ""))),
            "produto_cst_pis": row.get(mapping.get("produto_cst_pis", "")) or None,
            "produto_valor_pis": parse_safe_float(row.get(mapping.get("produto_valor_pis", ""))),
            "produto_cst_cofins": row.get(mapping.get("produto_cst_cofins", "")) or None,
            "produto_valor_cofins": parse_safe_float(row.get(mapping.get("produto_valor_cofins", ""))),
            "produto_valor_iss": parse_safe_float(row.get(mapping.get("produto_valor_iss", ""))),
            "produto_qtd": parse_safe_float(row.get(mapping.get("produto_qtd", ""))),
            "produto_valor_unit": parse_safe_float(row.get(mapping.get("produto_valor_unit", ""))),
            "produto_valor_total": parse_safe_float(row.get(mapping.get("produto_valor_total", ""))),
        }

        if not entry["produto_nome"]:
            entry["produto_nome"] = _guess_textual_value(row, textual_candidates)

        if entry["emitente_uf"]:
            entry["emitente_uf"] = str(entry["emitente_uf"]).upper()
        if entry["destinatario_uf"]:
            entry["destinatario_uf"] = str(entry["destinatario_uf"]).upper()

        nfe_id = entry.get("nfe_id")
        if nfe_id and isinstance(nfe_id, str):
            entry["nfe_id"] = nfe_id.strip() or None

        if entry["valor_total_nfe"] == 0.0 and nfe_id and nfe_id in totals_by_nfe:
            entry["valor_total_nfe"] = totals_by_nfe[nfe_id]

        if entry["produto_valor_total"] == 0.0:
            fallback_value = parse_safe_float(row.get(mapping.get("valor_total_nfe", "")))
            if fallback_value:
                entry["produto_valor_total"] = fallback_value
            elif nfe_id and nfe_id in totals_by_nfe:
                entry["produto_valor_total"] = totals_by_nfe[nfe_id]

        if entry["produto_valor_unit"] == 0.0 and entry["produto_qtd"]:
            qty = entry["produto_qtd"]
            if qty:
                entry["produto_valor_unit"] = (entry["produto_valor_total"] / qty) if qty else 0.0

        result.append(entry)

    column_mapping = {field: display_map.get(column, column) for field, column in mapping.items()}
    meta: Dict[str, object] = {
        "source": source_name,
        "row_count": len(rows),
        "column_mapping": column_mapping,
        "detection_confidence": detection_confidence,
        "unused_columns": unused_columns,
        "inferred_totals": totals_by_nfe,
        "matched_columns": {field: info["column"] for field, info in diagnostics.items()},
        "missing_fields": [field for field in CSV_FIELD_ALIASES.keys() if field not in mapping],
        "has_structured_table": True,
        "has_text_only": False,
    }

    return result, meta


def _sanitize_filename(filename: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in filename)


def _get_extension(path: Path) -> str:
    return path.suffix.lower().lstrip(".")


def _xml_text(node: Optional[ET.Element]) -> Optional[str]:
    if node is None:
        return None
    text = node.text or ""
    return text.strip() or None


def _mask_cnpj(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    digits = "".join(filter(str.isdigit, value))
    if len(digits) < 14:
        return value
    return f"{digits[:8]}****{digits[-2:]}"


def _find_child(element: Optional[ET.Element], tag: str) -> Optional[ET.Element]:
    if element is None:
        return None
    child = element.find(f"./{{*}}{tag}")
    if child is not None:
        return child
    return element.find(tag)


def _find_children(element: Optional[ET.Element], tag: str) -> List[ET.Element]:
    if element is None:
        return []
    children = element.findall(f"./{{*}}{tag}")
    return children or element.findall(tag)


def _find_path(element: Optional[ET.Element], path: str) -> Optional[ET.Element]:
    current = element
    for part in path.split('/'):
        current = _find_child(current, part)
        if current is None:
            return None
    return current


def _find_text(element: Optional[ET.Element], tag: str) -> Optional[str]:
    text = _xml_text(_find_child(element, tag))
    logger.info(f"Finding tag '{tag}': found text '{text}'")
    return text


def _find_path_text(element: Optional[ET.Element], path: str) -> Optional[str]:
    return _xml_text(_find_path(element, path))


def _parse_nfe_xml(xml_bytes: bytes) -> Tuple[List[Dict[str, object]], Optional[str]]:
    logger.info("Starting to parse NFe XML.")
    try:
        tree = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:  # pragma: no cover - defensive branch
        return [], f"XML malformado: {exc}"

    inf_nfe = tree.find('.//{*}infNFe') or tree.find('.//infNFe')
    if inf_nfe is None:
        return [], "Bloco <infNFe> nao encontrado no XML."

    items = _find_children(inf_nfe, 'det')
    if not items:
        return [], "Nenhum item <det> encontrado no XML."

    ide = _find_child(inf_nfe, 'ide') or ET.Element('ide')
    emit = _find_child(inf_nfe, 'emit') or ET.Element('emit')
    dest = _find_child(inf_nfe, 'dest') or ET.Element('dest')
    total = _find_child(inf_nfe, 'total') or ET.Element('total')
    icms_tot = _find_child(total, 'ICMSTot') or ET.Element('ICMSTot')
    issqn_tot = _find_child(total, 'ISSQNtot') or ET.Element('ISSQNtot')

    nfe_id = inf_nfe.get('Id') or inf_nfe.get('id')

    result: List[Dict[str, object]] = []
    total_products = 0.0
    total_services = 0.0
    for tag in ("vProd", "vServ"):
        value = parse_safe_float(_find_text(icms_tot, tag))
        if tag == "vProd":
            total_products = value
        else:
            total_services = value

    total_value = parse_safe_float(_find_text(icms_tot, 'vNF'))
    if total_value == 0:
        total_value = total_products + total_services

    for item in items:
        prod = _find_child(item, 'prod') or ET.Element('prod')
        imposto = _find_child(item, 'imposto') or ET.Element('imposto')
        icms_container = _find_child(imposto, 'ICMS') or ET.Element('ICMS')
        icms_children = list(icms_container)
        icms_block = icms_children[0] if icms_children else icms_container

        pis_container = _find_child(imposto, 'PIS') or ET.Element('PIS')
        pis_children = list(pis_container)
        pis_block = pis_children[0] if pis_children else pis_container

        cofins_container = _find_child(imposto, 'COFINS') or ET.Element('COFINS')
        cofins_children = list(cofins_container)
        cofins_block = cofins_children[0] if cofins_children else cofins_container

        issqn_block = _find_child(imposto, 'ISSQN') or ET.Element('ISSQN')

        entry: Dict[str, object] = {
            'nfe_id': nfe_id,
            'data_emissao': _find_text(ide, 'dhEmi'),
            'valor_total_nfe': total_value,
            'emitente_nome': _find_text(emit, 'xNome'),
            'emitente_cnpj': _mask_cnpj(_find_text(emit, 'CNPJ')),
            'emitente_uf': _find_path_text(emit, 'enderEmit/UF'),
            'destinatario_nome': _find_text(dest, 'xNome'),
            'destinatario_cnpj': _mask_cnpj(_find_text(dest, 'CNPJ')),
            'destinatario_uf': _find_path_text(dest, 'enderDest/UF'),
            'produto_nome': _find_text(prod, 'xProd'),
            'produto_ncm': _find_text(prod, 'NCM'),
            'produto_cfop': _find_text(prod, 'CFOP'),
            'produto_cst_icms': _find_text(icms_block, 'CST'),
            'produto_base_calculo_icms': parse_safe_float(_find_text(icms_block, 'vBC')),
            'produto_aliquota_icms': parse_safe_float(_find_text(icms_block, 'pICMS')),
            'produto_valor_icms': parse_safe_float(_find_text(icms_block, 'vICMS')),
            'produto_cst_pis': _find_text(pis_block, 'CST'),
            'produto_valor_pis': parse_safe_float(_find_text(pis_block, 'vPIS')),
            'produto_cst_cofins': _find_text(cofins_block, 'CST'),
            'produto_valor_cofins': parse_safe_float(_find_text(cofins_block, 'vCOFINS')),
            'produto_valor_iss': parse_safe_float(_find_text(issqn_block, 'vISSQN')),
            'produto_qtd': parse_safe_float(_find_text(prod, 'qCom')),
            'produto_valor_unit': parse_safe_float(_find_text(prod, 'vUnCom')),
            'produto_valor_total': parse_safe_float(_find_text(prod, 'vProd')),
        }
        result.append(entry)
    return result, None
def _parse_csv(path: Path) -> Tuple[List[Dict[str, object]], Optional[str], Dict[str, object]]:
    try:
        raw_bytes = path.read_bytes()
    except OSError as exc:  # pragma: no cover - unexpected filesystem error
        return [], f"Erro ao ler CSV: {exc}", {"source": path.name}

    text = _decode_csv_bytes(raw_bytes)
    rows, display_map = _read_csv_rows(text)
    if not rows:
        return [], "Nenhuma linha encontrada no CSV.", {
            "source": path.name,
            "row_count": 0,
            "column_mapping": {},
            "has_structured_table": False,
            "has_text_only": False,
        }

    data, meta = _convert_tabular_rows(rows, display_map, path.name)
    return data, None, meta


def _parse_json(path: Path) -> Tuple[List[Dict[str, object]], Optional[str]]:
    content = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(content, list):
        return [dict(item) for item in content], None
    raise ValueError("JSON deve ser uma lista de objetos")


def _extract_pdf_text(path: Path) -> Tuple[str, Optional[str]]:
    """Extrai texto de um PDF utilizando pdfminer e, se necessÃƒÂ¡rio, OCR via Tesseract."""
    try:
        from pdfminer.high_level import extract_text

        text = extract_text(str(path))
        if text and text.strip():
            return text, None
    except Exception as exc:  # pragma: no cover - depende de libs externas
        logger.warning("Falha ao extrair texto de %s com pdfminer: %s", path.name, exc)

    text_chunks: List[str] = []
    try:
        from pdf2image import convert_from_path
        import pytesseract

        images = convert_from_path(str(path))
        for image in images:
            extracted = pytesseract.image_to_string(image, lang="por+eng")
            if extracted:
                text_chunks.append(extracted)
    except Exception as exc:  # pragma: no cover - depende de poppler/tesseract
        logger.warning("Falha ao executar OCR em %s: %s", path.name, exc)

    text = "\n".join(chunk.strip() for chunk in text_chunks if chunk.strip())
    if text:
        return text, None
    return "", "NÃ‡Å“o foi possÃ¯Â¿Â½Ã¯Â¿Â½vel extrair conteÃ‡Â­do deste PDF."


def _extract_currency(raw_value: Optional[str]) -> Optional[float]:
    if not raw_value:
        return None
    normalized = raw_value.strip().replace(".", "").replace(",", ".")
    try:
        return float(normalized)
    except ValueError:
        return None


def _infer_metadata_from_text(text: str) -> Dict[str, Optional[str]]:
    metadata: Dict[str, Optional[str]] = {
        "nfe_id": None,
        "emitente_nome": None,
        "emitente_cnpj": None,
        "emitente_uf": None,
        "destinatario_nome": None,
        "destinatario_cnpj": None,
        "destinatario_uf": None,
        "valor_total_nfe": None,
        "cfop": None,
        "ncm": None,
    }

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    joined = "\n".join(lines)

    chave = re.search(r"(\d{44})", joined)
    if chave:
        metadata["nfe_id"] = chave.group(1)

    cfop = re.search(r"CFOP\s*[:\-]?\s*(\d{4})", joined, re.IGNORECASE)
    if cfop:
        metadata["cfop"] = cfop.group(1)

    ncm = re.search(r"NCM\s*[:\-]?\s*(\d{8})", joined, re.IGNORECASE)
    if ncm:
        metadata["ncm"] = ncm.group(1)

    total_match = re.search(r"Valor\s+Total(?:\s+da\s+NF-?e|)\s*[:\-]?\s*([\d\.,]+)", joined, re.IGNORECASE)
    if total_match:
        metadata["valor_total_nfe"] = total_match.group(1)

    cnpj_pattern = re.compile(r"CNPJ\s*[:\-]?\s*([\d\.\-/]{14,18})", re.IGNORECASE)
    cnpj_candidates: List[str] = []
    for idx, line in enumerate(lines):
        match = cnpj_pattern.search(line)
        if not match:
            continue
        digits = "".join(filter(str.isdigit, match.group(1)))
        if digits in cnpj_candidates:
            continue
        cnpj_candidates.append(digits)
        name = line[: match.start()].strip(":- ")
        if not name and idx > 0:
            name = lines[idx - 1]
        if len(cnpj_candidates) == 1:
            metadata["emitente_cnpj"] = digits
            metadata["emitente_nome"] = name or metadata["emitente_nome"]
        elif len(cnpj_candidates) == 2:
            metadata["destinatario_cnpj"] = digits
            metadata["destinatario_nome"] = name or metadata["destinatario_nome"]
            break

    uf_pattern = re.compile(r"\bUF\s*[:\-]?\s*([A-Z]{2})\b", re.IGNORECASE)
    uf_matches = uf_pattern.findall(joined)
    if uf_matches:
        metadata["emitente_uf"] = uf_matches[0].upper()
        if len(uf_matches) > 1:
            metadata["destinatario_uf"] = uf_matches[1].upper()

    return metadata


def _summarize_text_document(text: str, source_name: str) -> Tuple[List[Dict[str, object]], Dict[str, object]]:
    metadata = _infer_metadata_from_text(text)
    valor_total = _extract_currency(metadata.get("valor_total_nfe"))
    cfop = metadata.get("cfop")
    ncm = metadata.get("ncm")

    entry: Dict[str, object] = {
        "nfe_id": metadata.get("nfe_id"),
        "data_emissao": None,
        "valor_total_nfe": valor_total or 0.0,
        "emitente_nome": metadata.get("emitente_nome"),
        "emitente_cnpj": _mask_cnpj(metadata.get("emitente_cnpj")),
        "emitente_uf": metadata.get("emitente_uf"),
        "destinatario_nome": metadata.get("destinatario_nome"),
        "destinatario_cnpj": _mask_cnpj(metadata.get("destinatario_cnpj")),
        "destinatario_uf": metadata.get("destinatario_uf"),
        "produto_nome": f"Resumo {source_name}",
        "produto_ncm": ncm,
        "produto_cfop": cfop,
        "produto_cst_icms": None,
        "produto_base_calculo_icms": 0.0,
        "produto_aliquota_icms": 0.0,
        "produto_valor_icms": 0.0,
        "produto_cst_pis": None,
        "produto_valor_pis": 0.0,
        "produto_cst_cofins": None,
        "produto_valor_cofins": 0.0,
        "produto_valor_iss": 0.0,
        "produto_qtd": 1.0 if valor_total else 0.0,
        "produto_valor_unit": valor_total or 0.0,
        "produto_valor_total": valor_total or 0.0,
    }

    meta = {
        "extracted_fields": {key: value for key, value in metadata.items() if value},
        "has_text_only": True,
        "has_structured_table": False,
    }
    return [entry], meta


def _split_table_cells(line: str) -> List[str]:
    stripped = line.strip()
    if not stripped:
        return []
    if ';' in stripped and stripped.count(';') >= 2:
        return [cell.strip() for cell in stripped.split(';') if cell.strip()]
    if '|' in stripped and stripped.count('|') >= 2:
        return [cell.strip() for cell in stripped.split('|') if cell.strip()]
    if '\t' in stripped:
        return [cell.strip() for cell in stripped.split('\t') if cell.strip()]
    cells = re.split(r"\s{2,}", stripped)
    return [cell.strip() for cell in cells if cell.strip()]


def _extract_structured_rows_from_text(text: str) -> Tuple[List[Dict[str, str]], Dict[str, str], Dict[str, object]]:
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    candidate_tables: List[Tuple[List[str], List[Dict[str, str]], int, int]] = []
    idx = 0
    while idx < len(lines):
        header_cells = _split_table_cells(lines[idx])
        if len(header_cells) < 3 or not any(any(ch.isalpha() for ch in cell) for cell in header_cells):
            idx += 1
            continue
        rows: List[Dict[str, str]] = []
        idx2 = idx + 1
        while idx2 < len(lines):
            row_cells = _split_table_cells(lines[idx2])
            if not row_cells:
                idx2 += 1
                continue
            if len(row_cells) < max(2, len(header_cells) - 1):
                break
            if len(row_cells) != len(header_cells):
                if len(row_cells) > len(header_cells):
                    row_cells = row_cells[: len(header_cells)]
                else:
                    row_cells.extend(["" for _ in range(len(header_cells) - len(row_cells))])
            rows.append(dict(zip(header_cells, row_cells)))
            idx2 += 1
        if len(rows) >= 1:
            candidate_tables.append((header_cells, rows, idx, idx2))
            idx = idx2
        else:
            idx += 1

    if not candidate_tables:
        return [], {}, {}

    header, table_rows, start_idx, end_idx = max(candidate_tables, key=lambda item: len(item[1]))
    normalized_rows, display_map = _prepare_generic_rows(table_rows)
    table_meta = {
        "table_header": header,
        "table_start_line": start_idx,
        "table_end_line": end_idx,
        "table_row_count": len(table_rows),
    }
    return normalized_rows, display_map, table_meta


def _parse_tabular_text(text: str, source_name: str) -> Tuple[List[Dict[str, object]], Dict[str, object]]:
    rows, display_map, table_meta = _extract_structured_rows_from_text(text)
    if not rows:
        return [], {}
    data, meta = _convert_tabular_rows(rows, display_map, source_name)
    meta.update(table_meta)
    meta["has_structured_table"] = True
    meta["has_text_only"] = False
    return data, meta


def _parse_pdf(path: Path) -> Tuple[List[Dict[str, object]], Optional[str], Optional[str], Dict[str, object]]:
    text, error = _extract_pdf_text(path)
    if not text:
        return [], None, error, {}
    tabular_data, tabular_meta = _parse_tabular_text(text, path.name)
    if tabular_data:
        return tabular_data, text, None, tabular_meta
    data, meta = _summarize_text_document(text, path.name)
    return data, text, None, meta


def _parse_ocr(path: Path) -> Tuple[List[Dict[str, object]], Optional[str], Optional[str], Dict[str, object]]:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="latin-1")
    tabular_data, tabular_meta = _parse_tabular_text(text, path.name)
    if tabular_data:
        return tabular_data, text, None, tabular_meta
    data, meta = _summarize_text_document(text, path.name)
    return data, text, None, meta


def _handle_single_file(path: Path) -> ImportedDoc:
    ext = _get_extension(path)
    kind = SUPPORTED_KINDS.get(ext, "UNSUPPORTED")
    if kind == "UNSUPPORTED":
        return ImportedDoc(kind="UNSUPPORTED", name=path.name, size=path.stat().st_size, status="unsupported", error="Formato nao suportado.")

    try:
        text: Optional[str] = None
        meta: Dict[str, object] = {}
        if ext == "xml":
            data, error = _parse_nfe_xml(path.read_bytes())
        elif ext == "pdf":
            data, text, error, meta = _parse_pdf(path)
        elif ext == "ocr":
            data, text, error, meta = _parse_ocr(path)
        elif ext == "csv":
            data, error, meta = _parse_csv(path)
        elif ext == "json":
            data, error = _parse_json(path)
        else:  # pragma: no cover - defensive branch
            return ImportedDoc(kind="UNSUPPORTED", name=path.name, size=path.stat().st_size, status="unsupported", error="Formato nao suportado.")

        status = "parsed" if data else "error"
        return ImportedDoc(
            kind=kind,
            name=path.name,
            size=path.stat().st_size,
            status=status,
            data=data or None,
            text=text,
            error=error,
            meta=meta,
        )
    except Exception as exc:  # pragma: no cover - defensive branch
        logger.exception("Erro ao processar arquivo %s", path.name)
        return ImportedDoc(kind=kind, name=path.name, size=path.stat().st_size, status="error", error=str(exc))

def _handle_zip(path: Path, progress_callback: Optional[ProgressCallback]) -> List[ImportedDoc]:
    docs: List[ImportedDoc] = []
    with ZipFile(path, "r") as archive:
        members = [m for m in archive.infolist() if not m.is_dir()]
        total = len(members)
        for index, info in enumerate(members, start=1):
            if progress_callback:
                progress_callback(index, total)
            with archive.open(info, "r") as file_handle:
                filename = _sanitize_filename(info.filename)
                ext = filename.lower().split(".")[-1]
                logger.info(f"Handling file in zip: {filename}, extension: {ext}")
                data_bytes = file_handle.read()
                text = None
                meta_extra: Dict[str, object] = {}
                if ext == "xml":
                    data, error = _parse_nfe_xml(data_bytes)
                    size = len(data_bytes)
                    kind = "NFE_XML"
                elif ext == "pdf":
                    tmp_path = path.parent / f"__tmp_{_sanitize_filename(info.filename)}"
                    tmp_path.write_bytes(data_bytes)
                    try:
                        data, text, error, meta_extra = _parse_pdf(tmp_path)
                    finally:
                        if tmp_path.exists():
                            tmp_path.unlink()
                    size = len(data_bytes)
                    kind = "PDF"
                elif ext == "ocr":
                    tmp_path = path.parent / f"__tmp_{_sanitize_filename(info.filename)}"
                    tmp_path.write_bytes(data_bytes)
                    try:
                        data, text, error, meta_extra = _parse_ocr(tmp_path)
                    finally:
                        if tmp_path.exists():
                            tmp_path.unlink()
                    size = len(data_bytes)
                    kind = "OCR_TEXT"
                elif ext == "csv":
                    csv_text = _decode_csv_bytes(data_bytes)
                    rows, display_map = _read_csv_rows(csv_text)
                    size = len(data_bytes)
                    kind = "CSV"
                    if rows:
                        data, meta_extra = _convert_tabular_rows(rows, display_map, filename)
                        error = None
                    else:
                        data = []
                        meta_extra = {"source": filename, "row_count": 0, "column_mapping": {}}
                        error = "Nenhuma linha encontrada no CSV."
                else:
                    docs.append(
                        ImportedDoc(
                            kind="UNSUPPORTED",
                            name=filename,
                            size=info.file_size,
                            status="unsupported",
                            error="Formato nao suportado dentro do ZIP.",
                            meta={"source_zip": path.name, "internal_path": info.filename},
                        )
                    )
                    continue
                status = "parsed" if data else "error"
                zip_meta = {"source_zip": path.name, "internal_path": info.filename}
                if meta_extra:
                    zip_meta.update(meta_extra)
                docs.append(
                    ImportedDoc(
                        kind=kind,
                        name=filename,
                        size=size,
                        status=status,
                        data=data or None,
                        text=text,
                        error=error,
                        meta=zip_meta,
                    )
                )
    return docs


def extract_documents(file_paths: Iterable[str | Path], progress_callback: Optional[ProgressCallback] = None) -> List[ImportedDoc]:
    file_list = [Path(path) for path in file_paths]
    total = len(file_list)
    docs: List[ImportedDoc] = []
    for index, path in enumerate(file_list, start=1):
        if progress_callback:
            progress_callback(index, total)
        if _get_extension(path) == "zip":
            docs.extend(_handle_zip(path, progress_callback))
        else:
            docs.append(_handle_single_file(path))
    return docs


