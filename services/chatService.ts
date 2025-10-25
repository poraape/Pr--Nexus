import type { AuditReport, ChartData } from "../types";
import { apiFetch, buildApiUrl, extractErrorDetail } from "./httpClient";

type HistoryRole = "user" | "assistant";

export interface ConsultantHistoryItem {
  role: HistoryRole;
  content: string;
  chartData?: ChartData;
}

export interface ConsultantResponse {
  text: string;
  chartData?: ChartData | null;
}

interface BaseChatPayload {
  sessionId: string;
  history?: ConsultantHistoryItem[];
}

export interface InitializeSessionPayload extends BaseChatPayload {
  report: AuditReport;
  metadata?: Record<string, unknown>;
}

export interface ChatRequestPayload extends BaseChatPayload {
  question: string;
  stream?: boolean;
}

export interface StreamHandlers {
  onChunk: (chunk: string) => void;
  onFinal: (message: ConsultantResponse) => void;
  onError: (message: string) => void;
}

const toBody = (payload: Record<string, unknown>) =>
  JSON.stringify(payload, (_key, value) => (value === undefined ? null : value));

export async function initializeConsultantSession({
  sessionId,
  report,
  metadata,
  history,
}: InitializeSessionPayload): Promise<void> {
  await apiFetch("/api/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: toBody({
      session_id: sessionId,
      report,
      metadata,
      history: history ?? [],
    }),
  });
}

export async function sendChatMessage({
  sessionId,
  question,
  history = [],
  stream = false,
}: ChatRequestPayload): Promise<ConsultantResponse> {
  const response = await apiFetch("/api/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: toBody({
      session_id: sessionId,
      question,
      history,
      stream,
    }),
  });

  const payload = await response.json();
  return payload.message as ConsultantResponse;
}

export function streamChatMessage(
  { sessionId, question, history = [] }: ChatRequestPayload,
  handlers: StreamHandlers,
): { close: () => void } {
  const params = new URLSearchParams({
    payload: JSON.stringify({
      session_id: sessionId,
      question,
      history,
      stream: true,
    }),
  });

  const eventSource = new EventSource(`${buildApiUrl("/api/v1/chat")}?${params.toString()}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as
        | { type: "chunk"; content: string }
        | { type: "final"; message: ConsultantResponse }
        | { type: "error"; message: string };

      if (data.type === "chunk") {
        handlers.onChunk(data.content);
      } else if (data.type === "final") {
        handlers.onFinal(data.message);
        eventSource.close();
      } else if (data.type === "error") {
        handlers.onError(data.message || "Falha ao gerar resposta.");
        eventSource.close();
      }
    } catch (err) {
      handlers.onError("Resposta de streaming inválida do servidor.");
      eventSource.close();
    }
  };

  eventSource.onerror = () => {
    handlers.onError("Conexão de streaming interrompida.");
    eventSource.close();
  };

  return {
    close: () => eventSource.close(),
  };
}

export { extractErrorDetail };
