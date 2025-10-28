import { apiFetch, extractErrorDetail } from './httpClient';

export interface DynamicAnalysisResult {
  analysis_summary: {
    file_name: string;
    file_type: string;
    language: string;
    executive_summary: string;
  };
  data_schema: {
    is_structured: boolean;
    inferred_columns: {
      column_name: string;
      data_type: string;
      description: string;
    }[];
    delimiter: string | null;
  };
  key_insights: {
    insight_type: string;
    description: string;
    related_data: any;
  }[];
  visualizations: {
    visualization_type: string;
    title: string;
    x_axis_column: string;
    y_axis_column: string;
    description: string;
  }[];
  full_content_preview: string;
}

export const analysisService = {
  async analyzeFile(file: File): Promise<DynamicAnalysisResult> {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await apiFetch('/api/v1/analyze/dynamic', {
        method: 'POST',
        body: formData,
      });
      return await response.json();
    } catch (error: any) {
      // Attempt to get detailed error from backend response
      if (error.response) {
        const detail = await extractErrorDetail(error.response);
        throw new Error(detail || 'Falha ao analisar o arquivo.');
      }
      // Fallback for network errors or other issues
      throw new Error(error.message || 'Ocorreu um erro de rede ao contatar o servidor de análise.');
    }
  },
};
