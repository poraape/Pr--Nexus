import { apiFetch } from "./httpClient";
import { logger } from "./logger";

export const Type = {
    STRING: "string",
    NUMBER: "number",
    OBJECT: "object",
    ARRAY: "array",
    BOOLEAN: "boolean",
} as const;

export type ResponseSchema = {
    type: string | string[];
    properties?: Record<string, any>;
    items?: Record<string, any>;
    required?: string[];
    description?: string;
    enum?: string[];
    nullable?: boolean;
    anyOf?: any[];
};

export async function generateJSON<T = any>(
    model: string,
    prompt: string,
    schema: ResponseSchema
): Promise<T> {
    try {
        const response = await apiFetch("/api/v1/llm/generate-json", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, model, schema }),
        });

        const payload = await response.json();
        return payload.result as T;
    } catch (error) {
        logger.log('geminiService', 'ERROR', 'Falha ao solicitar geração JSON ao backend.', { error, model });
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('Ocorreu um erro desconhecido na comunicação com o backend.');
    }
}
