from __future__ import annotations

from pathlib import Path
from zipfile import ZipFile

from backend.agents.data_extractor_agent import extract_documents


def test_extract_csv(sample_csv: Path) -> None:
    docs = extract_documents([sample_csv])
    assert len(docs) == 1
    doc = docs[0]
    assert doc.status == "parsed"
    assert doc.kind == "CSV"
    assert doc.data and doc.data[0]["produto_nome"] == "Produto A"


def test_extract_zip(sample_csv: Path, tmp_path: Path) -> None:
    archive_path = tmp_path / "docs.zip"
    with ZipFile(archive_path, "w") as archive:
        archive.write(sample_csv, arcname="nested/nota.csv")
    docs = extract_documents([archive_path])
    assert any(doc.meta.get("source_zip") == archive_path.name for doc in docs)
