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

const API_BASE_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

const buildUrl = (path: string) => `${API_BASE_URL}${path}`;

export async function generateJSON<T = any>(
    model: string,
    prompt: string,
    schema: ResponseSchema
): Promise<T> {
    try {
        const response = await fetch(buildUrl("/api/v1/llm/generate-json"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, model, schema }),
        });

        if (!response.ok) {
            const detail = await extractErrorDetail(response);
            throw new Error(detail || "Falha na comunicação com o serviço de IA.");
        }

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

async function extractErrorDetail(response: Response): Promise<string | null> {
    try {
        const payload = await response.json();
        if (payload?.detail) {
            if (typeof payload.detail === "string") {
                return payload.detail;
            }
            if (Array.isArray(payload.detail) && payload.detail[0]?.msg) {
                return payload.detail[0].msg as string;
            }
        }
        return null;
    } catch {
        return null;
    }
}
