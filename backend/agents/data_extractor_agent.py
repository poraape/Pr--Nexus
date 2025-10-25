from __future__ import annotations

import csv
import io
import json
import logging
import re
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


def _parse_nfe_xml(xml_bytes: bytes) -> Tuple[List[Dict[str, object]], Optional[str]]:
    try:
        tree = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:  # pragma: no cover - defensive branch
        return [], f"XML malformado: {exc}"

    # Support optional root wrappers
    inf_nfe = tree.find(".//infNFe")
    if inf_nfe is None:
        return [], "Bloco <infNFe> nÃ£o encontrado no XML."

    items = inf_nfe.findall("det")
    if not items:
        return [], "Nenhum item <det> encontrado no XML."

    ide = inf_nfe.find("ide") or ET.Element("ide")
    emit = inf_nfe.find("emit") or ET.Element("emit")
    dest = inf_nfe.find("dest") or ET.Element("dest")
    total = inf_nfe.find("total") or ET.Element("total")
    icms_tot = total.find("ICMSTot") or ET.Element("ICMSTot")
    issqn_tot = total.find("ISSQNtot") or ET.Element("ISSQNtot")

    nfe_id = inf_nfe.get("Id")
    if not nfe_id:
        nfe_id = inf_nfe.get("id")

    result: List[Dict[str, object]] = []
    total_products = 0.0
    total_services = 0.0
    for tag in ("vProd", "vServ"):
        try:
            value = float(icms_tot.findtext(tag) or 0)
        except ValueError:
            value = 0.0
        if tag == "vProd":
            total_products = value
        else:
            total_services = value

    total_value = parse_safe_float(icms_tot.findtext("vNF"))
    if total_value == 0:
        total_value = total_products + total_services

    for item in items:
        prod = item.find("prod") or ET.Element("prod")
        imposto = item.find("imposto") or ET.Element("imposto")
        icms = list((imposto.find("ICMS") or ET.Element("ICMS")).iter())
        icms_block = icms[0] if icms else ET.Element("ICMS")
        pis = list((imposto.find("PIS") or ET.Element("PIS")).iter())
        pis_block = pis[0] if pis else ET.Element("PIS")
        cofins = list((imposto.find("COFINS") or ET.Element("COFINS")).iter())
        cofins_block = cofins[0] if cofins else ET.Element("COFINS")
        issqn_block = imposto.find("ISSQN") or ET.Element("ISSQN")

        entry: Dict[str, object] = {
            "nfe_id": nfe_id,
            "data_emissao": _xml_text(ide.find("dhEmi")),
            "valor_total_nfe": total_value,
            "emitente_nome": _xml_text(emit.find("xNome")),
            "emitente_cnpj": _mask_cnpj(_xml_text(emit.find("CNPJ")) or None),
            "emitente_uf": _xml_text(emit.find("enderEmit/UF")),
            "destinatario_nome": _xml_text(dest.find("xNome")),
            "destinatario_cnpj": _mask_cnpj(_xml_text(dest.find("CNPJ")) or None),
            "destinatario_uf": _xml_text(dest.find("enderDest/UF")),
            "produto_nome": _xml_text(prod.find("xProd")),
            "produto_ncm": _xml_text(prod.find("NCM")),
            "produto_cfop": _xml_text(prod.find("CFOP")),
            "produto_cst_icms": _xml_text(icms_block.find("CST")),
            "produto_base_calculo_icms": parse_safe_float(icms_block.findtext("vBC")),
            "produto_aliquota_icms": parse_safe_float(icms_block.findtext("pICMS")),
            "produto_valor_icms": parse_safe_float(icms_block.findtext("vICMS")),
            "produto_cst_pis": _xml_text(pis_block.find("CST")),
            "produto_valor_pis": parse_safe_float(pis_block.findtext("vPIS")),
            "produto_cst_cofins": _xml_text(cofins_block.find("CST")),
            "produto_valor_cofins": parse_safe_float(cofins_block.findtext("vCOFINS")),
            "produto_valor_iss": parse_safe_float(issqn_block.findtext("vISSQN")),
            "produto_qtd": parse_safe_float(prod.findtext("qCom")),
            "produto_valor_unit": parse_safe_float(prod.findtext("vUnCom")),
            "produto_valor_total": parse_safe_float(prod.findtext("vProd")),
        }
        result.append(entry)
    return result, None


def _parse_csv(path: Path) -> Tuple[List[Dict[str, object]], Optional[str]]:
    data: List[Dict[str, object]] = []
    with path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            data.append({k.strip(): v for k, v in row.items()})
    if not data:
        return [], "Nenhuma linha encontrada no CSV."
    return data, None


def _parse_json(path: Path) -> Tuple[List[Dict[str, object]], Optional[str]]:
    content = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(content, list):
        return [dict(item) for item in content], None
    raise ValueError("JSON deve ser uma lista de objetos")


def _extract_pdf_text(path: Path) -> Tuple[str, Optional[str]]:
    """Extrai texto de um PDF utilizando pdfminer e, se necessÃ¡rio, OCR via Tesseract."""
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
    return "", "NÇœo foi possï¿½ï¿½vel extrair conteÇ­do deste PDF."


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
    }
    return [entry], meta


def _parse_pdf(path: Path) -> Tuple[List[Dict[str, object]], Optional[str], Optional[str], Dict[str, object]]:
    text, error = _extract_pdf_text(path)
    if not text:
        return [], None, error, {}
    data, meta = _summarize_text_document(text, path.name)
    return data, text, None, meta


def _parse_ocr(path: Path) -> Tuple[List[Dict[str, object]], Optional[str], Optional[str], Dict[str, object]]:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="latin-1")
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
            data, error = _parse_csv(path)
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
                    text_stream = io.StringIO(data_bytes.decode("utf-8"))
                    reader = csv.DictReader(text_stream)
                    parsed = [{k.strip(): v for k, v in row.items()} for row in reader]
                    data = parsed
                    error = None if parsed else "Nenhuma linha encontrada no CSV."
                    size = len(data_bytes)
                    kind = "CSV"
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

