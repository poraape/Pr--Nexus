from __future__ import annotations


def parse_safe_float(value: object) -> float:
    """Replicates the tolerant parsing logic from the TypeScript helpers."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return 0.0

    s = value.strip()
    if not s:
        return 0.0

    if "," in s:
        s = s.replace(".", "").replace(" ", "")
        chars = []
        for char in s:
            if char.isdigit() or char in {",", "-"}:
                chars.append(char)
        s = "".join(chars).replace(",", ".")
    else:
        chars = []
        for char in s:
            if char.isdigit() or char in {".", "-"}:
                chars.append(char)
        s = "".join(chars)

    try:
        return float(s)
    except ValueError:
        return 0.0
