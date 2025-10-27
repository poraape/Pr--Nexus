from __future__ import annotations

import re


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
