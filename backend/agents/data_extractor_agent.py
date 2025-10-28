from __future__ import annotations

import csv
import io
import json
import logging
import re
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
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
        "valor total",
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

NUMERIC_FIELDS: Tuple[str, ...] = tuple(sorted(CSV_NUMERIC_FIELDS))

CATEGORICAL_FIELDS: Tuple[str, ...] = (
    "emitente_nome",
    "emitente_cnpj",
    "emitente_uf",
    "destinatario_nome",
    "destinatario_cnpj",
    "destinatario_uf",
    "produto_nome",
    "produto_cfop",
    "produto_ncm",
)

VALUE_WEIGHTED_FIELDS: Tuple[str, ...] = (
    "emitente_nome",
    "destinatario_nome",
    "emitente_uf",
    "destinatario_uf",
    "produto_nome",
    "produto_cfop",
)

DATE_FIELDS: Tuple[str, ...] = ("data_emissao",)

MAX_CHART_ITEMS = 6


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
    sample_lines = sample_text.splitlines()[:50]
    sample = "\n".join(sample_lines)
    sniffer = csv.Sniffer()
    counters = Counter({
        ",": sample.count(","),
        ";": sample.count(";"),
        "\t": sample.count("\t"),
        "|": sample.count("|"),
    })
    try:
        dialect = sniffer.sniff(sample, delimiters=",;|\t")
        candidate = dialect.delimiter
    except csv.Error:
        candidate = None
    if candidate:
        if candidate == ",":
            semicolons = counters[";"]
            commas = counters[","]
            if semicolons >= max(1, len(sample_lines)) and semicolons >= commas / 1.2:
                return ";"
        return candidate
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


def _contains_alpha(value: str) -> bool:
    return any(char.isalpha() for char in value)


def _looks_numeric(value: str) -> bool:
    if value is None:
        return False
    cleaned = str(value).strip()
    if not cleaned:
        return False
    cleaned = re.sub(r"[.\s]", "", cleaned.replace(",", "").replace("-", ""))
    return cleaned.isdigit()


def _is_data_like_row(row: List[str]) -> bool:
    if not row:
        return False
    numeric_cells = sum(1 for cell in row if _looks_numeric(cell))
    if numeric_cells / max(len(row), 1) >= 0.5:
        return True
    long_digit = any(len(re.sub(r"\D", "", cell)) >= 10 for cell in row if isinstance(cell, str))
    return long_digit


def _detect_header_row_index(rows: List[List[str]]) -> Optional[int]:
    if not rows:
        return None
    sample_lines = [";".join(row) for row in rows[:20]]
    sniffer = csv.Sniffer()
    try:
        if sniffer.has_header("\n".join(sample_lines)):
            if len(rows) > 1 and _is_data_like_row(rows[0]) and _is_data_like_row(rows[1]):
                pass
            else:
                return 0
    except csv.Error:
        pass

    best_idx: Optional[int] = None
    best_score = 0.0
    for idx, row in enumerate(rows[:5]):
        if not row:
            continue
        total = len(row)
        alpha_ratio = sum(1 for cell in row if _contains_alpha(cell)) / max(total, 1)
        numeric_ratio = sum(1 for cell in row if _looks_numeric(cell)) / max(total, 1)
        uniqueness = len({cell.strip().lower() for cell in row if cell.strip()}) / max(total, 1)
        punctuation = sum(1 for cell in row if ":" in cell or "-" in cell) / max(total, 1)
        score = (alpha_ratio * 0.6) + (uniqueness * 0.3) + (punctuation * 0.1) - (numeric_ratio * 0.4)
        if alpha_ratio == 0.0:
            score -= 0.5
        if _is_data_like_row(row):
            score -= 0.4
        if score > best_score:
            best_score = score
            best_idx = idx

    if best_idx is not None and best_score >= 0.2:
        return best_idx
    return None


def _generate_synthetic_headers(width: int) -> List[str]:
    return [f"column_{index + 1}" for index in range(width)]


def _decode_csv_bytes(data: bytes) -> str:
    encodings = ["utf-8-sig", "utf-16", "utf-8", "latin-1"]
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def _read_csv_rows(text: str) -> Tuple[List[Dict[str, str]], Dict[str, str], Dict[str, object]]:
    if not text:
        return [], {}, {
            "delimiter": ",",
            "header_index": None,
            "synthetic_header": True,
            "metadata_rows": 0,
            "column_count": 0,
            "total_rows_read": 0,
        }
    delimiter = _detect_csv_delimiter(text)
    buffer = io.StringIO(text)
    csv_reader = csv.reader(buffer, delimiter=delimiter, quotechar='"', skipinitialspace=True)
    raw_rows: List[List[str]] = []
    for row in csv_reader:
        if not row:
            continue
        cleaned = [cell.strip() if isinstance(cell, str) else cell for cell in row]
        if any(cell for cell in cleaned):
            raw_rows.append(cleaned)
    if not raw_rows:
        return [], {}

    header_idx = _detect_header_row_index(raw_rows)
    if header_idx is None:
        header = _generate_synthetic_headers(max(len(row) for row in raw_rows))
        data_rows = raw_rows
    else:
        header = raw_rows[header_idx]
        data_rows = raw_rows[header_idx + 1 :]

    sanitized_fieldnames, display_map = _sanitize_fieldnames(header)
    if not sanitized_fieldnames:
        width = max(len(row) for row in data_rows) if data_rows else len(header)
        header = _generate_synthetic_headers(width)
        sanitized_fieldnames, display_map = _sanitize_fieldnames(header)

    column_count = len(sanitized_fieldnames)
    rows: List[Dict[str, str]] = []
    for raw_row in data_rows:
        if not raw_row:
            continue
        normalized_row = list(raw_row)
        if len(normalized_row) < column_count:
            normalized_row.extend([""] * (column_count - len(normalized_row)))
        elif len(normalized_row) > column_count:
            normalized_row = normalized_row[:column_count]
        row_dict = {field: (value.strip() if isinstance(value, str) else value) for field, value in zip(sanitized_fieldnames, normalized_row)}
        if any((isinstance(value, str) and value) or value not in (None, "") for value in row_dict.values()):
            rows.append(row_dict)
    structure_meta = {
        "delimiter": delimiter,
        "header_index": header_idx,
        "synthetic_header": header_idx is None,
        "metadata_rows": header_idx or 0,
        "column_count": column_count,
        "total_rows_read": len(raw_rows),
        "data_rows": len(rows),
    }
    return rows, display_map, structure_meta


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
    header_lower = header.lower()
    if "valor" in header_lower:
        base_score += 0.2
    if "total" in header_lower:
        base_score += 0.2
    if "unit" in header_lower or "unitario" in header_lower or "unidade" in header_lower:
        base_score += 0.1
    if "qtd" in header_lower or "quant" in header_lower:
        base_score += 0.1
    if any(token in header_lower for token in ("modelo", "serie", "natureza", "indicador")):
        base_score -= 0.3
    return max(0.0, min(base_score, 1.0))


def _score_reasonable_amount(values: List[Optional[str]]) -> float:
    numeric_values: List[float] = []
    decimal_hint = 0
    for value in values:
        if value in (None, ""):
            continue
        if isinstance(value, str) and ("," in value or "." in value):
            decimal_hint += 1
        parsed = parse_safe_float(value)
        if parsed != 0.0:
            numeric_values.append(abs(parsed))
    if not numeric_values:
        return 0.0
    bounded = sum(1 for number in numeric_values if 1e-6 < number < 1e11)
    bounded_score = bounded / len(numeric_values)
    decimal_score = decimal_hint / max(len(values), 1)
    return min(1.0, bounded_score * 0.7 + decimal_score * 0.3)


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
    reusable_fields = {"valor_total_nfe"}

    for field, aliases in CSV_FIELD_ALIASES.items():
        best_column: Optional[str] = None
        best_score = 0.0
        for column in columns:
            if column in used_columns and field not in reusable_fields:
                continue
            score = _score_header_match(normalized_headers.get(column, ""), aliases)
            if score > best_score:
                best_column = column
                best_score = score
        if best_column and best_score >= 0.65:
            mapping[field] = best_column
            if field not in reusable_fields:
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
        "valor_total_nfe": lambda header, values: (
            _score_numeric_column(values, header + " total" if "nota" in header or "nf" in header else header)
            + (_score_reasonable_amount(values) * 0.6)
            - (_score_access_key_column(values) * 0.7)
        ),
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
            if column in used_columns and field not in reusable_fields:
                continue
            header = normalized_headers.get(column, "")
            values = collect_values(column)
            score = scorer(header, values)
            if score > best_score:
                best_score = score
                best_column = column
        if best_column and best_score >= 0.55:
            mapping[field] = best_column
            if field not in reusable_fields:
                used_columns.add(best_column)
            diagnostics[field] = {
                "column": display_map.get(best_column, best_column),
                "score": round(best_score, 3),
                "matched_by": "values",
            }

    def _prefer_column(field: str, predicate: Callable[[str], bool]) -> None:
        current = mapping.get(field)
        if not current or predicate(normalized_headers.get(current, "")):
            return
        for column in columns:
            if column == current:
                continue
            normalized = normalized_headers.get(column, "")
            if not predicate(normalized):
                continue
            if column in used_columns and field not in reusable_fields:
                continue
            if field not in reusable_fields:
                used_columns.discard(current)
                used_columns.add(column)
            mapping[field] = column
            diagnostics[field] = {
                "column": display_map.get(column, column),
                "score": 1.0,
                "matched_by": "alias_adjustment",
            }
            break

    _prefer_column(
        "valor_total_nfe",
        lambda header: (
            ("valor" in header) or ("total" in header)
        )
        and "chave" not in header
        and "modelo" not in header,
    )
    _prefer_column(
        "produto_nome",
        lambda header: ("descricao" in header or "produto servico" in header or "produto" in header and "descricao" in header)
        and "numero" not in header
        and "cod" not in header
    )

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


def _parse_any_date(value: str) -> Optional[date]:
    if not value:
        return None
    cleaned = str(value).strip()
    if not cleaned:
        return None
    normalized = cleaned.replace("T", " ").replace("Z", "").strip()
    try:
        return datetime.fromisoformat(normalized).date()
    except ValueError:
        pass
    candidate = normalized.split(" ")[0]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(candidate, fmt).date()
        except ValueError:
            continue
    digits_only = re.sub(r"\D", "", cleaned)
    if len(digits_only) == 8:
        for fmt in ("%Y%m%d", "%d%m%Y"):
            try:
                return datetime.strptime(digits_only, fmt).date()
            except ValueError:
                continue
    return None


class _SemanticAnalyzer:
    def __init__(self, display_map: Dict[str, str], mapping: Dict[str, str]) -> None:
        self.display_map = display_map
        self.mapping = mapping
        self.row_count = 0
        self.numeric_totals: Dict[str, float] = defaultdict(float)
        self.numeric_min: Dict[str, float] = {}
        self.numeric_max: Dict[str, float] = {}
        self.category_counts: Dict[str, Counter[str]] = {field: Counter() for field in CATEGORICAL_FIELDS}
        self.category_weighted_totals: Dict[str, Dict[str, float]] = {
            field: defaultdict(float) for field in VALUE_WEIGHTED_FIELDS
        }
        self.timeline_totals: Dict[str, float] = defaultdict(float)
        self.date_values: List[date] = []
        self.sample_records: List[Dict[str, object]] = []

    def observe(self, entry: Dict[str, object]) -> None:
        self.row_count += 1
        if len(self.sample_records) < 3:
            self.sample_records.append({key: entry.get(key) for key in entry})

        default_weight = entry.get("produto_valor_total") or entry.get("valor_total_nfe") or 0.0
        weight = parse_safe_float(default_weight)

        for field in NUMERIC_FIELDS:
            value = entry.get(field)
            if value in (None, ""):
                continue
            numeric_value = parse_safe_float(value)
            self.numeric_totals[field] += numeric_value
            current_min = self.numeric_min.get(field)
            if current_min is None or numeric_value < current_min:
                self.numeric_min[field] = numeric_value
            current_max = self.numeric_max.get(field)
            if current_max is None or numeric_value > current_max:
                self.numeric_max[field] = numeric_value

        for field in CATEGORICAL_FIELDS:
            raw_value = entry.get(field)
            if not raw_value:
                continue
            label = str(raw_value)
            self.category_counts[field][label] += 1
            if field in self.category_weighted_totals:
                self.category_weighted_totals[field][label] += weight

        for field in DATE_FIELDS:
            date_value = entry.get(field)
            if not date_value:
                continue
            parsed = _parse_any_date(str(date_value))
            if parsed:
                self.date_values.append(parsed)
                self.timeline_totals[parsed.isoformat()] += weight

    def _top_categories(self, field: str) -> List[Dict[str, object]]:
        counter = self.category_counts.get(field)
        if not counter:
            return []
        return [{"label": label, "count": count} for label, count in counter.most_common(MAX_CHART_ITEMS)]

    def _top_weighted(self, field: str) -> List[Dict[str, object]]:
        totals = self.category_weighted_totals.get(field)
        if not totals:
            return []
        sorted_totals = sorted(totals.items(), key=lambda item: item[1], reverse=True)[:MAX_CHART_ITEMS]
        return [{"label": label, "value": round(value, 2)} for label, value in sorted_totals]

    def finalize(self) -> Dict[str, object]:
        numeric_totals = {
            field: round(total, 4) for field, total in self.numeric_totals.items() if total not in (0.0, 0)
        }
        numeric_ranges = {
            field: {"min": round(self.numeric_min[field], 4), "max": round(self.numeric_max[field], 4)}
            for field in self.numeric_min
        }
        unique_counts = {
            field: len(counter) for field, counter in self.category_counts.items() if counter
        }
        top_categories = {
            field: self._top_categories(field)
            for field, counter in self.category_counts.items()
            if counter
        }
        value_distribution = {
            field: self._top_weighted(field)
            for field in VALUE_WEIGHTED_FIELDS
            if self.category_weighted_totals.get(field)
        }

        visualizations: List[Dict[str, object]] = []
        top_products = value_distribution.get("produto_nome") or []
        if top_products:
            visualizations.append(
                {
                    "type": "bar",
                    "title": "Top Produtos por Valor",
                    "labels": [item["label"] for item in top_products],
                    "values": [item["value"] for item in top_products],
                    "field": "produto_nome",
                    "metric": "produto_valor_total",
                }
            )
        top_emitentes = value_distribution.get("emitente_nome") or []
        if top_emitentes:
            visualizations.append(
                {
                    "type": "bar",
                    "title": "Top Emitentes por Valor",
                    "labels": [item["label"] for item in top_emitentes],
                    "values": [item["value"] for item in top_emitentes],
                    "field": "emitente_nome",
                    "metric": "valor_total_nfe",
                }
            )
        if len(self.timeline_totals) >= 2:
            ordered_timeline = sorted(self.timeline_totals.items())
            visualizations.append(
                {
                    "type": "line",
                    "title": "Evolução Temporal do Valor",
                    "labels": [label for label, _ in ordered_timeline],
                    "values": [round(value, 2) for _, value in ordered_timeline],
                    "metric": "valor_total",
                }
            )

        insights: List[str] = []
        if top_emitentes:
            total_emitente = sum(item["value"] for item in top_emitentes)
            leader = top_emitentes[0]
            if total_emitente:
                share = leader["value"] / total_emitente
                if share >= 0.5:
                    insights.append(
                        f"{leader['label']} concentra {share:.0%} do valor total consolidado nas notas processadas."
                    )
        if top_products:
            total_products = sum(item["value"] for item in top_products)
            leader = top_products[0]
            if total_products:
                share = leader["value"] / total_products
                if share >= 0.4:
                    insights.append(
                        f"O produto {leader['label']} representa {share:.0%} do valor movimentado em produtos/serviços."
                    )
        if len(self.timeline_totals) >= 2:
            ordered = sorted(self.timeline_totals.items())
            first_value = ordered[0][1]
            last_value = ordered[-1][1]
            if first_value:
                variation = (last_value - first_value) / first_value
                if variation >= 0.15:
                    insights.append(
                        f"Há tendência de alta de {variation:.0%} no valor total entre {ordered[0][0]} e {ordered[-1][0]}."
                    )
                elif variation <= -0.15:
                    insights.append(
                        f"Há tendência de queda de {abs(variation):.0%} no valor total entre {ordered[0][0]} e {ordered[-1][0]}."
                    )

        temporal_coverage = None
        if self.date_values:
            temporal_coverage = {
                "start": min(self.date_values).isoformat(),
                "end": max(self.date_values).isoformat(),
            }

        semantic_summary = {
            "record_count": self.row_count,
            "column_count": len(self.display_map),
            "numeric_totals": numeric_totals,
            "numeric_ranges": numeric_ranges,
            "unique_counts": unique_counts,
            "top_categories": top_categories,
            "value_distribution": value_distribution,
        }
        processing_stats = {
            "mode": "incremental",
            "rows_processed": self.row_count,
            "columns_detected": len(self.display_map),
            "parallelized": False,
        }

        return {
            "semantic_summary": semantic_summary,
            "visualizations": visualizations,
            "insights": insights,
            "processing_stats": processing_stats,
            "temporal_coverage": temporal_coverage,
            "sample_records": self.sample_records,
        }


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
            "analysis_scope": "full_document",
            "processing_stats": {
                "mode": "incremental",
                "rows_processed": 0,
                "columns_detected": len(display_map),
                "parallelized": False,
            },
        }

    mapping, diagnostics = _infer_column_mapping(rows, display_map)
    totals_by_nfe = _aggregate_totals(rows, mapping)
    columns = list(display_map.keys())
    unused_columns = [display_map.get(column, column) for column in columns if column not in mapping.values()]
    detection_confidence = {field: info["score"] for field, info in diagnostics.items()}

    analyzer = _SemanticAnalyzer(display_map, mapping)
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
        elif isinstance(entry["produto_nome"], str) and not _contains_alpha(entry["produto_nome"]):
            fallback_name = _guess_textual_value(row, textual_candidates)
            if fallback_name:
                entry["produto_nome"] = fallback_name

        if entry["emitente_uf"]:
            entry["emitente_uf"] = str(entry["emitente_uf"]).upper()
        if entry["destinatario_uf"]:
            entry["destinatario_uf"] = str(entry["destinatario_uf"]).upper()

        nfe_id = entry.get("nfe_id")
        if nfe_id and isinstance(nfe_id, str):
            entry["nfe_id"] = nfe_id.strip() or None
            nfe_id = entry["nfe_id"]

        if (
            nfe_id
            and nfe_id in totals_by_nfe
            and (
                mapping.get("valor_total_nfe") == mapping.get("nfe_id")
                or (
                    isinstance(entry["valor_total_nfe"], (int, float))
                    and entry["valor_total_nfe"] >= 1e12
                )
            )
        ):
            entry["valor_total_nfe"] = totals_by_nfe[nfe_id]

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

        analyzer.observe(entry)
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
        "analysis_scope": "full_document",
    }
    semantic_meta = analyzer.finalize()
    if not semantic_meta.get("temporal_coverage"):
        semantic_meta.pop("temporal_coverage", None)
    meta.update(semantic_meta)

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
    rows, display_map, structure_meta = _read_csv_rows(text)
    if not rows:
        empty_meta = {
            "source": path.name,
            "row_count": 0,
            "column_mapping": {},
            "has_structured_table": False,
            "has_text_only": False,
            "analysis_scope": "full_document",
            "structure": structure_meta,
            "processing_stats": {
                "mode": "incremental",
                "rows_processed": 0,
                "columns_detected": structure_meta.get("column_count", 0),
                "parallelized": False,
            },
        }
        return [], "Nenhuma linha encontrada no CSV.", empty_meta

    data, meta = _convert_tabular_rows(rows, display_map, path.name)
    meta["structure"] = structure_meta
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

    analyzer = _SemanticAnalyzer({key: key for key in entry.keys()}, {key: key for key in entry.keys()})
    analyzer.observe(entry)
    semantic_meta = analyzer.finalize()
    if "processing_stats" in semantic_meta:
        semantic_meta["processing_stats"]["mode"] = "textual-summary"

    meta = {
        "extracted_fields": {key: value for key, value in metadata.items() if value},
        "has_text_only": True,
        "has_structured_table": False,
        "analysis_scope": "full_document",
    }
    meta.update(semantic_meta)
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
                    rows, display_map, structure_meta = _read_csv_rows(csv_text)
                    size = len(data_bytes)
                    kind = "CSV"
                    if rows:
                        data, meta_extra = _convert_tabular_rows(rows, display_map, filename)
                        meta_extra["structure"] = structure_meta
                        error = None
                    else:
                        data = []
                        meta_extra = {
                            "source": filename,
                            "row_count": 0,
                            "column_mapping": {},
                            "has_structured_table": False,
                            "has_text_only": False,
                            "analysis_scope": "full_document",
                            "structure": structure_meta,
                            "processing_stats": {
                                "mode": "incremental",
                                "rows_processed": 0,
                                "columns_detected": structure_meta.get("column_count", 0),
                                "parallelized": False,
                            },
                        }
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


def _process_path(path: Path) -> List[ImportedDoc]:
    if _get_extension(path) == "zip":
        return _handle_zip(path, None)
    return [_handle_single_file(path)]


def extract_documents(file_paths: Iterable[str | Path], progress_callback: Optional[ProgressCallback] = None) -> List[ImportedDoc]:
    file_list = [Path(path) for path in file_paths]
    total = len(file_list)
    if total == 0:
        return []
    if total > 1 and progress_callback is None:
        parallel_docs: List[ImportedDoc] = []
        with ThreadPoolExecutor(max_workers=min(4, total)) as executor:
            futures = [(index, executor.submit(_process_path, path)) for index, path in enumerate(file_list)]
            ordered_results: List[Tuple[int, List[ImportedDoc]]] = []
            for index, future in futures:
                ordered_results.append((index, future.result()))
        ordered_results.sort(key=lambda item: item[0])
        for _, docs_chunk in ordered_results:
            parallel_docs.extend(docs_chunk)
        for doc in parallel_docs:
            stats = doc.meta.get("processing_stats")
            if isinstance(stats, dict):
                stats["parallelized"] = True
        return parallel_docs

    docs: List[ImportedDoc] = []
    for index, path in enumerate(file_list, start=1):
        if progress_callback:
            progress_callback(index, total)
        if _get_extension(path) == "zip":
            docs.extend(_handle_zip(path, progress_callback))
        else:
            docs.append(_handle_single_file(path))
    return docs


