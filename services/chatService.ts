import { Type, Chat } from "@google/genai";
import { createChatSession, streamChatMessage } from './geminiService';

const chatResponseSchema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING, description: "Textual response to the user's query." },
    chartData: {
      type: Type.OBJECT,
      description: "Optional: Chart data if the query can be visualized.",
      properties: {
        type: { type: Type.STRING, enum: ['bar', 'pie', 'line', 'scatter'], description: "Type of chart." },
        title: { type: Type.STRING, description: "Title of the chart." },
        data: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              value: { type: Type.NUMBER },
              x: { type: Type.NUMBER, nullable: true, description: "X-value for scatter plots." }
            },
            required: ['label', 'value'],
          },
        },
        xAxisLabel: { type: Type.STRING, nullable: true },
        yAxisLabel: { type: Type.STRING, nullable: true },
      },
      nullable: true,
    },
  },
  required: ['text'],
};

export const startChat = (dataSample: string, aggregatedMetrics?: Record<string, any>): Chat => {
  const systemInstruction = `
        You are an expert fiscal data analyst assistant.
        The user has provided you with a data sample in CSV format, extracted from fiscal documents. The columns have been normalized.
        
        I have already performed deterministic calculations and can provide you with these aggregated totals as a source of truth:
        ---
        Aggregated Metrics:
        ${JSON.stringify(aggregatedMetrics || { info: "Nenhuma métrica agregada calculada." }, null, 2)}
        ---

        Here is a small sample of the raw line-item data for more detailed queries:
        ---
        Data Sample:
        ${dataSample}
        ---
        
        Your primary goal is to help the user explore and understand this data. Follow these rules:
        1.  Source of Truth: For questions about totals (e.g., "Qual o valor total?"), you MUST use the 'Aggregated Metrics' provided above. For detailed questions (e.g., "Qual o produto mais caro?"), use the 'Data Sample'.
        2.  Ask for Clarification: If a request is vague, ask a clarifying question.
        3.  Be Proactive: After answering, suggest a related analysis.
        4.  Generate Visualizations: If a query can be visualized, you MUST provide the chart data. Otherwise, set 'chartData' to null. Include axis labels (xAxisLabel, yAxisLabel) where appropriate.
        5.  Language and Format: Always respond in Brazilian Portuguese. Your entire response must be a single, valid JSON object, adhering to the required schema.
    `;

  return createChatSession(
    'gemini-2.5-flash',
    systemInstruction,
    chatResponseSchema
  );
};

export const sendMessageStream = (chat: Chat, message: string): AsyncGenerator<string> => {
  return streamChatMessage(chat, message);
}
