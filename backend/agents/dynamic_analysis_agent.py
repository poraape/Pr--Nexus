from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict

from backend.services.llm_client import LLMClient
from backend.utils.content_extractor import (
    extract_text_from_csv,
    extract_text_from_pdf,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
Você é um especialista em análise de dados e documentos. Sua tarefa é analisar o conteúdo de um arquivo ({file_type}) e extrair informações estruturadas, insights e um resumo.

Responda SOMENTE com um objeto JSON válido, seguindo estritamente a estrutura abaixo. Não inclua nenhuma explicação ou texto fora do JSON.

Estrutura do JSON de resposta:
{
  "analysis_summary": {
    "file_name": "O nome do arquivo analisado.",
    "file_type": "O tipo de arquivo (CSV ou PDF).",
    "language": "O idioma principal do conteúdo (e.g., 'Português', 'Inglês').",
    "executive_summary": "Um resumo conciso (2-3 frases) sobre o propósito e os principais pontos do documento."
  },
  "data_schema": {
    "is_structured": "Boolean que indica se o arquivo contém dados tabulares estruturados.",
    "inferred_columns": [
      {
        "column_name": "O nome inferido para a coluna.",
        "data_type": "O tipo de dado inferido (e.g., 'Texto', 'Número', 'Data', 'Moeda').",
        "description": "Uma breve descrição do que a coluna representa."
      }
    ],
    "delimiter": "Para CSVs, o delimitador detectado (e.g., ',', ';'). Null para outros tipos."
  },
  "key_insights": [
    {
      "insight_type": "O tipo de insight (e.g., 'Tendência', 'Anomalia', 'Métrica Chave', 'Correlação').",
      "description": "Descrição detalhada do insight encontrado.",
      "related_data": "Dados ou valores específicos que suportam o insight."
    }
  ],
  "visualizations": [
    {
      "visualization_type": "O tipo de gráfico sugerido (e.g., 'Barras', 'Linhas', 'Pizza').",
      "title": "Um título para o gráfico.",
      "x_axis_column": "O nome da coluna para o eixo X.",
      "y_axis_column": "O nome da coluna para o eixo Y.",
      "description": "Uma breve explicação do que o gráfico mostraria."
    }
  ],
  "full_content_preview": "Uma prévia do conteúdo de texto completo extraído do arquivo (limite de 1500 caracteres)."
}
"""

USER_PROMPT_TEMPLATE = """
Analise o seguinte conteúdo do arquivo '{file_name}' e gere a resposta JSON estruturada.

Conteúdo do arquivo:
---
{file_content}
---
"""


class DynamicAnalysisAgent:
    def __init__(self, llm_client: LLMClient):
        self._llm_client = llm_client

    def _run_llm_analysis(self, content: str, file_name: str, file_type: str) -> Dict[str, Any]:
        """Constrói o prompt e executa a análise com o LLM."""
        system_prompt = SYSTEM_PROMPT.format(file_type=file_type)
        user_prompt = USER_PROMPT_TEMPLATE.format(
            file_name=file_name,
            file_content=content[:8000]  # Limita o tamanho para evitar exceder limites do modelo
        )
        
        full_prompt = f"{system_prompt}\n\n{user_prompt}"

        logger.info(f"Iniciando análise com LLM para o arquivo: {file_name}")
        
        try:
            response_text = self._llm_client.generate(
                prompt=full_prompt,
                response_mime="application/json"
            )
            
            # O LLM pode retornar o JSON dentro de um bloco de código markdown
            if response_text.strip().startswith("```json"):
                response_text = response_text.strip()[7:-3].strip()

            return json.loads(response_text)
        except json.JSONDecodeError as e:
            logger.error(f"Erro ao decodificar JSON da resposta do LLM: {e}\nResposta recebida: {response_text}")
            raise ValueError("A resposta do modelo de linguagem não é um JSON válido.") from e
        except Exception as e:
            logger.error(f"Erro inesperado durante a análise do LLM: {e}", exc_info=True)
            raise

    def analyze_document(self, file_path_str: str) -> Dict[str, Any]:
        """
        Analisa um arquivo (PDF ou CSV), extrai seu conteúdo e usa um LLM
        para obter insights estruturados.
        """
        file_path = Path(file_path_str)
        if not file_path.exists():
            raise FileNotFoundError(f"O arquivo não foi encontrado: {file_path_str}")

        file_extension = file_path.suffix.lower()
        file_name = file_path.name

        content: str
        file_type: str

        if file_extension == ".pdf":
            file_type = "PDF"
            content = extract_text_from_pdf(file_path)
        elif file_extension == ".csv":
            file_type = "CSV"
            content = extract_text_from_csv(file_path)
        else:
            raise ValueError(f"Formato de arquivo não suportado: {file_extension}")

        if not content.strip():
            raise ValueError(f"Nenhum conteúdo pôde ser extraído do arquivo: {file_name}")

        analysis_result = self._run_llm_analysis(content, file_name, file_type)
        
        # Garante que o preview do conteúdo seja adicionado, caso o LLM o omita.
        if "full_content_preview" not in analysis_result or not analysis_result.get("full_content_preview"):
            analysis_result["full_content_preview"] = content[:1500]

        return analysis_result
