from __future__ import annotations

import dataclasses
from enum import Enum
from typing import Any


def to_serializable(value: Any) -> Any:
    """Recursively convert dataclasses and enums to JSON serializable structures."""

    if dataclasses.is_dataclass(value):
        return {key: to_serializable(getattr(value, key)) for key in value.__dataclass_fields__}
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): to_serializable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_serializable(item) for item in value]
    return value
