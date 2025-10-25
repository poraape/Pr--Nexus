// nlpAgent.ts
import { Type } from "@google/genai";
import { logger } from "../services/logger";
import { generateJSON } from "../services/geminiService";

const nlpExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    data_emissao: { type: Type.STRING, description: "Data de emissão no formato DD/MM/AAAA.", nullable: true },
    valor_total_nfe: { type: Type.NUMBER, description: "Valor monetário total da nota.", nullable: true },
    emitente_nome: { type: Type.STRING, nullable: true },
    emitente_cnpj: { type: Type.STRING, nullable: true },
    destinatario_nome: { type: Type.STRING, nullable: true },
    destinatario_cnpj: { type: Type.STRING, nullable: true },
    items: {
      type: Type.ARRAY,
      description: "Lista de todos os produtos ou serviços na nota.",
      items: {
        type: Type.OBJECT,
        properties: {
          produto_nome: { type: Type.STRING },
          produto_ncm: { type: Type.STRING, nullable: true },
          produto_cfop: { type: Type.STRING, nullable: true },
          produto_qtd: { type: Type.NUMBER, nullable: true },
          produto_valor_unit: { type: Type.NUMBER, nullable: true },
          produto_valor_total: { type: Type.NUMBER, nullable: true },
        },
        required: ['produto_nome'],
      },
    },
  },
};

/**
 * Tenta extrair dados fiscais estruturados de um bloco de texto usando a IA do Gemini.
 * @param text O texto bruto extraído de um PDF ou imagem.
 * @returns Uma promessa que resolve para um array de objetos de dados extraídos. Retorna array vazio se nada for encontrado.
 */
export const extractDataFromText = async (text: string): Promise<Record<string, any>[]> => {
    if (!text || text.trim().length < 20) {
        logger.log('nlpAgent', 'WARN', 'Texto muito curto para extração com IA, pulando.');
        return [];
    }

    // Trunca o texto para evitar exceder os limites de token, mantendo as partes mais relevantes.
    const truncatedText = text.length > 15000 ? text.substring(0, 15000) : text;

    const prompt = `
      Você é um sistema de extração de dados (OCR/NLP) especializado em documentos fiscais brasileiros.
      Analise o texto a seguir e extraia as informações estruturadas de acordo com o schema JSON fornecido.
      - Se um campo não for encontrado, omita-o ou use null.
      - Converta todos os valores monetários para números (ex: "1.234,56" se torna 1234.56).
      - Se múltiplos itens forem encontrados, liste todos eles no array 'items'.
      - Se for um DANFE, pode haver apenas um item genérico representando a nota inteira.

      Texto para análise:
      ---
      ${truncatedText}
      ---
    `;

    try {
        const extracted = await generateJSON<{ items?: any[] } & Record<string, any>>(
            'gemini-2.5-flash',
            prompt,
            nlpExtractionSchema
        );
        
        if (!extracted.items || extracted.items.length === 0) {
            logger.log('nlpAgent', 'WARN', 'IA não extraiu itens do texto.');
            return [];
        }

        // Achata a estrutura para corresponder ao formato esperado pelo resto do pipeline.
        const { items, ...headerData } = extracted;
        const result = items.map(item => ({
            ...headerData,
            ...item
        }));

        logger.log('nlpAgent', 'INFO', `IA extraiu ${result.length} item(ns) do texto.`);
        return result;

    } catch (e) {
        // A log e o erro já são tratados dentro de `generateJSON`.
        // Apenas logamos o contexto específico do NLP Agent.
        logger.log('nlpAgent', 'ERROR', 'Falha na extração de dados com IA.', { error: e });
        return []; // Retorna vazio em caso de falha para não quebrar o pipeline.
    }
};
