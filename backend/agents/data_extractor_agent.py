from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from backend.types import ImportedDoc
from backend.utils.parsing import parse_safe_float

ProgressCallback = Callable[[int, int], None]
SUPPORTED_KINDS = {
    "xml": "NFE_XML",
    "csv": "CSV",
    "json": "CSV",
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


def _parse_nfe_xml(xml_bytes: bytes) -> Tuple[List[Dict[str, object]], Optional[str]]:
    try:
        tree = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:  # pragma: no cover - defensive branch
        return [], f"XML malformado: {exc}"

    # Support optional root wrappers
    inf_nfe = tree.find(".//infNFe")
    if inf_nfe is None:
        return [], "Bloco <infNFe> não encontrado no XML."

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

    def _mask_cnpj(value: Optional[str]) -> Optional[str]:
        if not value or len(value) < 14:
            return value
        return f"{value[:8]}****{value[-2:]}"

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


def _handle_single_file(path: Path) -> ImportedDoc:
    ext = _get_extension(path)
    kind = SUPPORTED_KINDS.get(ext, "UNSUPPORTED")
    if kind == "UNSUPPORTED":
        return ImportedDoc(kind="UNSUPPORTED", name=path.name, size=path.stat().st_size, status="unsupported", error="Formato não suportado.")

    try:
        if ext == "xml":
            data, error = _parse_nfe_xml(path.read_bytes())
        elif ext == "csv":
            data, error = _parse_csv(path)
        elif ext == "json":
            data, error = _parse_json(path)
        else:  # pragma: no cover - defensive branch
            return ImportedDoc(kind="UNSUPPORTED", name=path.name, size=path.stat().st_size, status="unsupported", error="Formato não suportado.")

        status = "parsed" if data else "error"
        return ImportedDoc(kind=kind, name=path.name, size=path.stat().st_size, status=status, data=data or None, error=error)
    except Exception as exc:  # pragma: no cover - defensive branch
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
                if ext == "xml":
                    data, error = _parse_nfe_xml(data_bytes)
                    size = len(data_bytes)
                    kind = "NFE_XML"
                elif ext == "csv":
                    text = io.StringIO(data_bytes.decode("utf-8"))
                    reader = csv.DictReader(text)
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
                            error="Formato não suportado dentro do ZIP.",
                            meta={"source_zip": path.name, "internal_path": info.filename},
                        )
                    )
                    continue

                status = "parsed" if data else "error"
                docs.append(
                    ImportedDoc(
                        kind=kind,
                        name=filename,
                        size=size,
                        status=status,
                        data=data or None,
                        error=error,
                        meta={"source_zip": path.name, "internal_path": info.filename},
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
