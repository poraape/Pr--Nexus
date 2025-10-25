import { Type } from "@google/genai";
import type { AuditReport, AIDrivenInsight, CrossValidationResult } from '../types';
import Papa from 'papaparse';
import { logger } from "../services/logger";
import { generateJSON } from "../services/geminiService";

const intelligenceSchema = {
  type: Type.OBJECT,
  properties: {
    aiDrivenInsights: {
      type: Type.ARRAY,
      description: "Anomalias, riscos ou oportunidades que não são violações de regras, but are fiscally relevant.",
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, enum: ['Eficiência Operacional', 'Risco Fiscal', 'Oportunidade de Otimização', 'Anomalia de Dados'] },
          description: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ['INFO', 'BAIXA', 'MÉDIA', 'ALTA'] },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['category', 'description', 'severity', 'evidence']
      }
    },
    crossValidationResults: {
      type: Type.ARRAY,
      description: "Discrepâncias encontradas ao comparar itens entre diferentes documentos.",
      items: {
        type: Type.OBJECT,
        properties: {
          attribute: { type: Type.STRING, description: "O campo fiscal com valores conflitantes (ex: 'NCM', 'Preço Unitário')." },
          observation: { type: Type.STRING, description: "Breve explicação da IA sobre a inconsistência." },
          documents: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Nome do documento de origem." },
                // FIX: Replaced invalid union type with `Type.STRING` as Gemini schema does not support it. 
                // The description guides the model to return a string representation for both numbers and text.
                value: { type: Type.STRING, description: "O valor conflitante, retornado como uma string para acomodar tanto números quanto texto." }
              },
              required: ['name', 'value']
            }
          }
        },
        required: ['attribute', 'observation', 'documents']
      }
    }
  },
  required: ['aiDrivenInsights', 'crossValidationResults']
};

/**
 * Sanitizes a value for safe inclusion in a CSV string for an AI prompt.
 * This helps prevent the AI from generating malformed JSON when it includes
 * the sanitized data in its response.
 * @param value The value to sanitize.
 * @returns The sanitized value, properly escaped.
 */
const sanitizeForAI = (value: any): any => {
    if (typeof value === 'string') {
        // Use JSON.stringify to correctly escape quotes, backslashes, and control characters,
        // then slice off the outer quotes it adds. This is safer than regex replacement.
        return JSON.stringify(value).slice(1, -1);
    }
    return value;
};


/**
 * Runs advanced AI-driven analysis to find anomalies and cross-document inconsistencies.
 * @param report The audit report after initial auditing and classification.
 * @returns A promise resolving to the AI-driven insights and cross-validation results.
 */
export const runIntelligenceAnalysis = async (
    report: Omit<AuditReport, 'summary' | 'aiDrivenInsights' | 'crossValidationResults'>
): Promise<Pick<AuditReport, 'aiDrivenInsights' | 'crossValidationResults'>> => {
    
    const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data);
    if (validDocs.length < 2) {
        logger.log('IntelligenceAgent', 'INFO', 'Análise de IA pulada: menos de 2 documentos válidos para comparação.');
        return { aiDrivenInsights: [], crossValidationResults: [] };
    }
    
    const allItems = validDocs.flatMap(d => {
        const docName = d.doc.name;
        return d.doc.data!.map(item => ({ ...item, doc_source: docName }));
    });

    // Sanitize text fields before sending them to the AI to prevent JSON parsing errors.
    const sanitizedItems = allItems.map(item => {
        const newItem: Record<string, any> = {};
        for (const key in item) {
            newItem[key] = sanitizeForAI((item as any)[key]);
        }
        return newItem;
    });

    const dataSampleForAI = Papa.unparse(sanitizedItems.slice(0, 500));
    
    const deterministicFindings = report.documents
        .flatMap(d => d.inconsistencies.map(inc => ({ document: d.doc.name, message: inc.message, severity: inc.severity })))
        .slice(0, 30);

    const prompt = `
        Você é um auditor fiscal sênior com IA. Sua tarefa é realizar uma análise profunda em um conjunto de dados fiscais extraídos de várias notas fiscais.
        
        Já realizei uma auditoria baseada em regras e encontrei estas inconsistências de ALTA PRIORIDADE:
        ---
        Resultados da Auditoria Determinística (Amostra Prioritária):
        ${JSON.stringify(deterministicFindings, null, 2)}
        ---

        Aqui está uma amostra dos dados de itens de todas as notas fiscais (em formato CSV):
        ---
        Amostra de Dados:
        ${dataSampleForAI}
        ---

        Suas tarefas são:
        1.  **aiDrivenInsights:** Analise os dados para encontrar padrões, anomalias e oportunidades que as regras não pegam. Ignore as inconsistências já listadas. Exemplos:
            - Um mesmo produto ('produto_nome') com grande variação de preço unitário ('produto_valor_unit') entre notas.
            - Um produto classificado com NCMs diferentes em notas distintas.
            - Oportunidades de crédito fiscal não aproveitadas.
            - Padrões de compra ou venda incomuns.
        2.  **crossValidationResults:** Compare os itens entre si (inter-documentos) e liste as discrepâncias mais significativas. Foque em conflitos no mesmo atributo (ex: NCM diferente para o mesmo produto). Não compare valores totais que naturalmente variam, a menos que a variação seja anômala (o que pertence a 'aiDrivenInsights').

        Responda em Português do Brasil. Sua resposta DEVE ser um único objeto JSON que adere ao schema fornecido. Não inclua texto fora do objeto JSON.
    `;
    
    try {
        const result = await generateJSON<{
            aiDrivenInsights: AIDrivenInsight[],
            crossValidationResults: CrossValidationResult[]
        }>(
            'gemini-2.5-flash',
            prompt,
            intelligenceSchema
        );
        
        return result;

    } catch (e) {
        logger.log('IntelligenceAgent', 'ERROR', 'Falha ao executar análise de inteligência com IA.', { error: e });
        console.error("AI Intelligence Agent failed:", e);
        // Return empty results on failure to avoid breaking the pipeline
        return { aiDrivenInsights: [], crossValidationResults: [] };
    }
};