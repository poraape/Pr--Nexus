from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

def extract_text_from_pdf(file_path: Path) -> str:
    """Extrai texto de um arquivo PDF usando pdfminer."""
    try:
        from pdfminer.high_level import extract_text
        logger.info(f"Extraindo texto do PDF: {file_path}")
        text = extract_text(str(file_path))
        if not text.strip():
            logger.warning(f"Nenhum texto extraído do PDF: {file_path}. O arquivo pode ser baseado em imagem.")
            return ""
        return text
    except Exception as e:
        logger.error(f"Falha ao extrair texto do PDF {file_path}: {e}", exc_info=True)
        raise IOError(f"Não foi possível processar o arquivo PDF: {file_path.name}") from e

def extract_text_from_csv(file_path: Path) -> str:
    """Lê o conteúdo bruto de um arquivo CSV."""
    try:
        logger.info(f"Lendo conteúdo do CSV: {file_path}")
        # Para a análise semântica pelo LLM, o conteúdo de texto é suficiente.
        # O modelo irá inferir o delimitador, cabeçalhos e estrutura.
        return file_path.read_text(encoding="utf-8-sig")
    except Exception as e:
        logger.error(f"Falha ao ler o arquivo CSV {file_path}: {e}", exc_info=True)
        raise IOError(f"Não foi possível ler o arquivo CSV: {file_path.name}") from e
