from __future__ import annotations

from typing import Dict, List

from backend.types import Inconsistency
from backend.utils.parsing import parse_safe_float
from backend.utils.rules_dictionary import INCONSISTENCIES


def run_fiscal_validation(item: Dict[str, object]) -> List[Inconsistency]:
    findings: List[Inconsistency] = []
    cfop = str(item.get("produto_cfop") or "")
    ncm = str(item.get("produto_ncm") or "")
    cst_icms = (item.get("produto_cst_icms") or "")
    cst_pis = (item.get("produto_cst_pis") or "")
    cst_cofins = (item.get("produto_cst_cofins") or "")

    q_com = parse_safe_float(item.get("produto_qtd"))
    v_un_com = parse_safe_float(item.get("produto_valor_unit"))
    v_prod = parse_safe_float(item.get("produto_valor_total"))

    if cfop.startswith("5") or cfop.startswith("6"):
        destinatario = str(item.get("destinatario_nome") or "").lower()
        if "quantum innovations" in destinatario:
            findings.append(INCONSISTENCIES["CFOP_SAIDA_EM_COMPRA"])

    if ncm == "00000000" and not any(
        isinstance(item.get(field), str) and "servi" in str(item.get(field)).lower()
        for field in ("produto_nome",)
    ):
        findings.append(INCONSISTENCIES["NCM_SERVICO_PARA_PRODUTO"])
    if ncm and ncm != "00000000" and len(ncm) != 8:
        findings.append(INCONSISTENCIES["NCM_INVALIDO"])

    if q_com > 0 and v_un_com > 0 and v_prod > 0:
        calculated_total = q_com * v_un_com
        difference = abs(calculated_total - v_prod)
        if difference > (calculated_total * 0.001) and difference > 0.01:
            findings.append(INCONSISTENCIES["VALOR_CALCULO_DIVERGENTE"])

    if v_prod == 0 and q_com > 0:
        findings.append(INCONSISTENCIES["VALOR_PROD_ZERO"])

    emit_uf = str(item.get("emitente_uf") or "").strip().upper()
    dest_uf = str(item.get("destinatario_uf") or "").strip().upper()
    if emit_uf and dest_uf and cfop:
        if cfop.startswith("6") and emit_uf == dest_uf:
            findings.append(INCONSISTENCIES["CFOP_INTERESTADUAL_UF_INCOMPATIVEL"])
        elif cfop.startswith("5") and emit_uf != dest_uf:
            findings.append(INCONSISTENCIES["CFOP_ESTADUAL_UF_INCOMPATIVEL"])

    is_return = cfop.startswith("12") or cfop.startswith("22") or cfop.startswith("52") or cfop.startswith("62")
    tributado_normal_pis_cofins = {"01", "02"}
    if is_return and (str(cst_pis) in tributado_normal_pis_cofins or str(cst_cofins) in tributado_normal_pis_cofins):
        findings.append(INCONSISTENCIES["PIS_COFINS_CST_INVALIDO_PARA_DEVOLUCAO"])

    tributado_normal_icms = {"00", "20"}
    if is_return and str(cst_icms) in tributado_normal_icms:
        findings.append(INCONSISTENCIES["ICMS_CST_INVALIDO_PARA_CFOP"])

    v_bc_icms = parse_safe_float(item.get("produto_base_calculo_icms"))
    p_icms = parse_safe_float(item.get("produto_aliquota_icms"))
    v_icms = parse_safe_float(item.get("produto_valor_icms"))

    if v_bc_icms > 0 and p_icms > 0 and v_icms > 0:
        calculated_icms = v_bc_icms * (p_icms / 100)
        difference = abs(calculated_icms - v_icms)
        if difference > 0.015:
            findings.append(INCONSISTENCIES["ICMS_CALCULO_DIVERGENTE"])

    return findings
