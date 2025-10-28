from __future__ import annotations

from pathlib import Path
from zipfile import ZipFile

import pytest

from backend.agents.data_extractor_agent import extract_documents, _parse_tabular_text


def test_extract_csv(sample_csv: Path) -> None:
    docs = extract_documents([sample_csv])
    assert len(docs) == 1
    doc = docs[0]
    assert doc.status == "parsed"
    assert doc.kind == "CSV"
    assert doc.data and doc.data[0]["produto_nome"] == "Produto A"
    assert doc.meta["processing_stats"]["mode"] == "incremental"
    assert doc.meta["semantic_summary"]["record_count"] == 1


def test_extract_zip(sample_csv: Path, tmp_path: Path) -> None:
    archive_path = tmp_path / "docs.zip"
    with ZipFile(archive_path, "w") as archive:
        archive.write(sample_csv, arcname="nested/nota.csv")
    docs = extract_documents([archive_path])
    assert any(doc.meta.get("source_zip") == archive_path.name for doc in docs)


def test_extract_csv_with_dynamic_headers(tmp_path: Path) -> None:
    content = (
        "Chave NF;Data NF;Descrição do Produto;CFOP Código;Código NCM;Qtde;Preço Unitário;Total Item;UF Origem;UF Destino;CNPJ Emissor;CNPJ Cliente\n"
        "11111111111111111111111111111111111111111111;2024-01-02;Serviço Especial;5933;99887766;3;150,50;451,50;sp;rj;12.345.678/0001-90;98.765.432/0001-00\n"
    )
    path = tmp_path / "dinamico.csv"
    path.write_text(content, encoding="utf-8")

    docs = extract_documents([path])
    assert len(docs) == 1
    doc = docs[0]
    assert doc.data and len(doc.data) == 1
    entry = doc.data[0]
    assert entry["produto_nome"] == "Serviço Especial"
    assert entry["emitente_uf"] == "SP"
    assert entry["destinatario_uf"] == "RJ"
    assert entry["produto_valor_total"] == pytest.approx(451.5)
    assert entry["valor_total_nfe"] == pytest.approx(451.5)
    assert doc.meta.get("has_structured_table") is True
    assert "produto_nome" in doc.meta.get("column_mapping", {})
    assert doc.meta["structure"]["synthetic_header"] is False
    assert doc.meta["visualizations"], "Expected visualization suggestions for dynamic header CSVs."


def test_parse_tabular_text_from_pdf_like_content() -> None:
    text = (
        "Produto           CFOP    Quantidade    Valor Total\n"
        "Produto A         5102    2            100,00\n"
        "Serviço B         5933    1            300,50\n"
    )

    data, meta = _parse_tabular_text(text, "simulado.pdf")
    assert len(data) == 2
    first, second = data
    assert first["produto_nome"] == "Produto A"
    assert second["produto_nome"] == "Serviço B"
    assert first["produto_cfop"] == "5102"
    assert second["produto_valor_total"] == pytest.approx(300.5)
    assert meta.get("has_structured_table") is True
    assert meta.get("table_row_count") == 2


def test_extract_csv_without_headers_generates_semantic_meta(tmp_path: Path) -> None:
    content = (
        "11111111111111111111111111111111111111111111;451,50;451,50;150,50;3;5102;99887766;2024-01-10;SP;RJ;Servico Ultra\n"
        "22222222222222222222222222222222222222222222;200,00;200,00;200,00;1;5102;99887766;2024-01-15;SP;MG;Servico Ultra\n"
    )
    path = tmp_path / "sem_cabecalho.csv"
    path.write_text(content, encoding="utf-8")

    docs = extract_documents([path])
    assert len(docs) == 1
    doc = docs[0]
    assert doc.kind == "CSV"
    assert doc.meta["structure"]["synthetic_header"] is True
    assert doc.data and len(doc.data) == 2
    first = doc.data[0]
    assert first["nfe_id"].startswith("111111")
    assert first["produto_nome"] == "Servico Ultra"
    assert first["valor_total_nfe"] == pytest.approx(451.5)
    summary = doc.meta["semantic_summary"]
    assert summary["record_count"] == 2
    assert doc.meta["visualizations"], "Expected at least one visualization suggestion."
    assert any(v.get("type") == "line" for v in doc.meta["visualizations"]), "Expected timeline visualization for dated dataset."
