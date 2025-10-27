from __future__ import annotations

import re
from typing import Dict, List


def parse_safe_float(value: object) -> float:
    """Converts a string to a float, handling different decimal and thousands separators."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return 0.0

    s = value.strip()
    if not s:
        return 0.0

    # Keep only digits, comma, dot and minus sign
    s = "".join(filter(lambda char: char in "0123456789,.-.", s))

    # If both comma and dot are present, assume dot is thousands separator
    if ',' in s and '.' in s:
        # If comma is after dot, comma is decimal separator
        if s.rfind(',') > s.rfind('.'):
            s = s.replace('.', '').replace(',', '.')
        # If dot is after comma, dot is decimal separator
        else:
            s = s.replace(',', '')
    # If only comma is present, it's the decimal separator
    elif ',' in s:
        s = s.replace(',', '.')
    
    if not s:
        return 0.0

    try:
        return float(s)
    except ValueError:
        return 0.0

def create_column_mapping(headers: List[str]) -> Dict[str, str]:
    """Creates a mapping from CSV headers to canonical field names."""
    mapping = {}
    header_map = {h.lower().strip(): h for h in headers}

    # Define possible variations for each canonical field
    canonical_fields = {
        'nfe_id': ['chave de acesso', 'nfe_id', 'id da nfe'],
        'data_emissao': ['data emissão', 'data_emissao', 'data'],
        'valor_total_nfe': ['valor total nfe', 'valor_total_nfe'],
        'emitente_nome': ['razão social emitente', 'emitente_nome', 'nome do emitente'],
        'emitente_cnpj': ['cpf/cnpj emitente', 'emitente_cnpj', 'cnpj do emitente'],
        'emitente_uf': ['uf emitente', 'emitente_uf', 'uf do emitente'],
        'destinatario_nome': ['nome destinatário', 'destinatario_nome', 'nome do destinatário'],
        'destinatario_cnpj': ['cnpj destinatário', 'destinatario_cnpj', 'cnpj do destinatário'],
        'destinatario_uf': ['uf destinatário', 'destinatario_uf', 'uf do destinatário'],
        'produto_nome': ['descrição do produto/serviço', 'produto_nome', 'nome do produto'],
        'produto_ncm': ['código ncm/sh', 'produto_ncm', 'ncm do produto'],
        'produto_cfop': ['cfop', 'cfop do produto'],
        'produto_qtd': ['quantidade', 'produto_qtd', 'qtd'],
        'produto_valor_unit': ['valor unitário', 'produto_valor_unit', 'valor unit'],
        'produto_valor_total': ['valor total', 'produto_valor_total', 'valor total do produto'],
    }

    for canonical, variations in canonical_fields.items():
        for var in variations:
            if var in header_map:
                mapping[canonical] = header_map[var]
                break
    
    return mapping
