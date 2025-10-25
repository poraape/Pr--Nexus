from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List

from fastapi import UploadFile

from backend.types import StorageGateway


class FileStorage(StorageGateway):
    """File-system based storage for uploaded documents."""

    def __init__(self, base_path: Path) -> None:
        self._base_path = base_path
        self._base_path.mkdir(parents=True, exist_ok=True)

    async def persist_upload(self, task_id: str, file: UploadFile) -> Dict[str, str]:
        """Save an uploaded file to disk and return its reference metadata."""

        safe_name = Path(file.filename or "upload").name
        task_dir = self._base_path / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        destination = task_dir / safe_name
        contents = await file.read()
        destination.write_bytes(contents)
        return {"path": str(destination), "original_name": safe_name}

    def load_files(self, references: Iterable[Dict[str, object]]) -> List[str]:
        paths: List[str] = []
        for reference in references:
            raw_path = reference.get("path")
            if not isinstance(raw_path, str):
                continue
            path = Path(raw_path)
            if not path.is_file():
                raise FileNotFoundError(f"Arquivo de referência não encontrado: {raw_path}")
            paths.append(str(path))
        return paths
