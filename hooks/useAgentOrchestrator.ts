import { useState, useCallback, useRef, useEffect } from 'react';
import { startChat, sendMessageStream } from '../services/chatService';
import type { ChatMessage, AuditReport, ClassificationResult } from '../types';
import type { Chat } from '@google/genai';
import Papa from 'papaparse';
import { logger } from '../services/logger';

export type AgentName = 'ocr' | 'auditor' | 'classifier' | 'crossValidator' | 'intelligence' | 'accountant';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'error';
export interface AgentProgress {
  step: string;
  current: number;
  total: number;
}
export type AgentState = { status: AgentStatus; progress: AgentProgress; };
export type AgentStates = Record<AgentName, AgentState>;

const initialAgentStates: AgentStates = {
  ocr: { status: 'pending', progress: { step: 'Aguardando arquivos', current: 0, total: 0 } },
  auditor: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  classifier: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  crossValidator: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  intelligence: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  accountant: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
};

/**
 * Analyzes an error object to provide a more specific, user-friendly message,
 * inspired by the nexus_connectivity_validator manifest.
 * @param error The error object caught.
 * @returns A detailed, actionable error message string.
 */
const getDetailedErrorMessage = (error: unknown): string => {
  logger.log('ErrorHandler', 'ERROR', 'Analisando erro da aplicação.', { error });

  if (error instanceof Error) {
    // Network/CORS errors in browsers often manifest as TypeErrors
    if (error.name === 'TypeError' && error.message.toLowerCase().includes('failed to fetch')) {
      return 'Falha de conexão. Verifique sua internet ou possíveis problemas de CORS.';
    }

    const message = error.message.toLowerCase();
    if (message.includes('api key not valid')) {
      return 'Chave de API inválida. Verifique sua configuração.';
    }
    if (message.includes('quota')) {
      return 'Cota da API excedida. Por favor, tente novamente mais tarde.';
    }
    // Check for common HTTP status codes that might be in the message from the SDK
    if (message.includes('400')) return 'Requisição inválida para a API. Verifique os dados enviados.';
    if (message.includes('401') || message.includes('permission denied')) return 'Não autorizado. Verifique sua chave de API e permissões.';
    if (message.includes('429')) return 'Muitas requisições. Por favor, aguarde e tente novamente.';
    if (message.includes('500') || message.includes('503')) return 'O serviço de IA está indisponível ou com problemas. Tente novamente mais tarde.';

    return error.message; // Return the original message if no specific pattern is found
  }

  if (typeof error === 'string') {
    return error;
  }

  // FIX: Rewrote to be a more robust type guard for object-like errors.
  // This prevents "property does not exist on type 'unknown'" errors by safely checking properties.
  if (typeof error === 'object' && error !== null) {
    // Check for a 'message' property
    if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
    // Check for a 'status' property, which is common in fetch API errors
    if ('status' in error && typeof (error as { status: unknown }).status === 'number') {
      const status = (error as { status: number }).status;
      // Provide a generic message based on the status code
      return `Ocorreu um erro de rede ou API com o status: ${status}.`;
    }
  }

  return 'Ocorreu um erro desconhecido durante a operação.';
};

interface BackendAgentProgress {
  step?: string;
  current?: number;
  total?: number;
}

interface BackendAgentState extends BackendAgentProgress {
  status?: string;
  progress?: BackendAgentProgress;
}

interface StatusResponse {
  status?: string;
  agents?: Record<string, BackendAgentState>;
  message?: string;
  error?: string;
}

const normalizeAgentStatus = (status?: string): AgentStatus => {
  const normalized = status?.toUpperCase();
  switch (normalized) {
    case 'RUNNING':
    case 'IN_PROGRESS':
      return 'running';
    case 'COMPLETED':
    case 'DONE':
    case 'SUCCESS':
      return 'completed';
    case 'FAILED':
    case 'FAILURE':
    case 'ERROR':
      return 'error';
    case 'PENDING':
    default:
      return 'pending';
  }
};

const mergeProgress = (previous: AgentProgress, incoming?: BackendAgentProgress): AgentProgress => ({
  step: incoming?.step ?? previous.step,
  current: incoming?.current ?? previous.current,
  total: incoming?.total ?? previous.total,
});

export const useAgentOrchestrator = () => {
  const [agentStates, setAgentStates] = useState<AgentStates>(initialAgentStates);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<boolean>(false);
  const [isPipelineComplete, setIsPipelineComplete] = useState(false);

  const chatRef = useRef<Chat | null>(null);
  const streamController = useRef<AbortController | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const lastCompletedTaskIdRef = useRef<string | null>(null);

  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearPolling();
  }, [clearPolling]);

  const handleReportSuccess = useCallback(async (taskId: string) => {
    try {
      const reportResponse = await fetch(`/api/v1/report/${taskId}`);
      if (!reportResponse.ok) {
        const message = await reportResponse.text();
        throw new Error(message || `Falha ao obter relatório (${reportResponse.status}).`);
      }

      const finalReport = (await reportResponse.json()) as AuditReport;
      setAuditReport(finalReport);
      setPipelineError(false);
      setError(null);
      setIsPipelineComplete(true);
      currentTaskIdRef.current = null;
      lastCompletedTaskIdRef.current = taskId;

      setAgentStates(prev => {
        const updated = { ...prev };
        (Object.keys(updated) as AgentName[]).forEach(agent => {
          if (updated[agent].status !== 'error') {
            updated[agent] = {
              status: 'completed',
              progress: updated[agent].progress,
            };
          }
        });
        return updated;
      });

      const validDocsData = finalReport.documents
        ?.filter(d => d.status !== 'ERRO' && d.doc?.data)
        .flatMap(d => d.doc.data ?? []) ?? [];

      const dataSampleForAI = validDocsData.length > 0
        ? Papa.unparse(validDocsData.slice(0, 200))
        : 'Sem dados tabulares disponíveis para amostragem.';

      logger.log('ChatService', 'INFO', 'Iniciando sessão de chat com a IA.');
      chatRef.current = startChat(dataSampleForAI, finalReport.aggregatedMetrics);
      setMessages([
        {
          id: 'initial-ai-message',
          sender: 'ai',
          text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
        },
      ]);
    } catch (reportError) {
      const detailedMessage = getDetailedErrorMessage(reportError);
      setPipelineError(true);
      setError(detailedMessage);
      setIsPipelineComplete(true);
      logger.log('Orchestrator', 'ERROR', 'Falha ao obter relatório final do backend.', { error: reportError });
    }
  }, []);

  const reset = useCallback(() => {
    clearPolling();
    currentTaskIdRef.current = null;
    lastCompletedTaskIdRef.current = null;
    setAgentStates(initialAgentStates);
    setError(null);
    setPipelineError(false);
    setAuditReport(null);
    setMessages([]);
    chatRef.current = null;
    setIsPipelineComplete(false);
  }, [clearPolling]);

  const runPipeline = useCallback(async (files: File[]) => {
    logger.log('Orchestrator', 'INFO', 'Iniciando novo pipeline de análise via backend.');
    reset();

    if (!files || files.length === 0) {
      const message = 'Nenhum arquivo foi selecionado para upload.';
      setError(message);
      setPipelineError(true);
      setIsPipelineComplete(true);
      setAgentStates(prev => ({
        ...prev,
        ocr: { status: 'error', progress: { step: message, current: 0, total: 0 } },
      }));
      return;
    }

    setAgentStates({
      ...initialAgentStates,
      ocr: { status: 'running', progress: { step: 'Enviando arquivos para análise...', current: 0, total: files.length } },
    });

    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));

      const uploadResponse = await fetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const message = await uploadResponse.text();
        throw new Error(message || `Falha no upload (${uploadResponse.status}).`);
      }

      const { task_id: taskId } = (await uploadResponse.json()) as { task_id?: string };
      if (!taskId) {
        throw new Error('Resposta do servidor não contém task_id.');
      }

      currentTaskIdRef.current = taskId;

      const pollStatus = async () => {
        if (!currentTaskIdRef.current) {
          return;
        }

        try {
          const statusResponse = await fetch(`/api/v1/status/${currentTaskIdRef.current}`);
          if (!statusResponse.ok) {
            const message = await statusResponse.text();
            throw new Error(message || `Falha ao consultar status (${statusResponse.status}).`);
          }

          const statusData = (await statusResponse.json()) as StatusResponse;

          if (statusData.agents) {
            setAgentStates(prev => {
              const updated = { ...prev };
              (Object.keys(initialAgentStates) as AgentName[]).forEach(agent => {
                const backendState = statusData.agents?.[agent];
                if (!backendState) return;

                const normalizedStatus = normalizeAgentStatus(backendState.status ?? (backendState as BackendAgentState).status);
                const progress = backendState.progress ?? {
                  step: backendState.step,
                  current: backendState.current,
                  total: backendState.total,
                };

                updated[agent] = {
                  status: normalizedStatus,
                  progress: mergeProgress(updated[agent]?.progress ?? initialAgentStates[agent].progress, progress),
                };
              });
              return updated;
            });
          }

          const overallStatus = statusData.status?.toUpperCase();
          if (overallStatus === 'SUCCESS') {
            clearPolling();
            await handleReportSuccess(taskId);
          } else if (overallStatus === 'FAILURE') {
            clearPolling();
            currentTaskIdRef.current = null;
            setPipelineError(true);
            const failureMessage = statusData.error || statusData.message || 'A análise falhou no servidor.';
            setError(failureMessage);
            setAgentStates(prev => {
              const updated = { ...prev };
              (Object.keys(updated) as AgentName[]).forEach(agent => {
                if (updated[agent].status === 'running') {
                  updated[agent] = {
                    ...updated[agent],
                    status: 'error',
                  };
                }
              });
              return updated;
            });
            setIsPipelineComplete(true);
          }
        } catch (pollError) {
          clearPolling();
          currentTaskIdRef.current = null;
          const detailedMessage = getDetailedErrorMessage(pollError);
          setPipelineError(true);
          setError(detailedMessage);
          setIsPipelineComplete(true);
          logger.log('Orchestrator', 'ERROR', 'Erro durante o polling de status do backend.', { error: pollError });
        }
      };

      await pollStatus();
      if (currentTaskIdRef.current) {
        pollingIntervalRef.current = setInterval(pollStatus, 3000);
      }
    } catch (err: unknown) {
      clearPolling();
      currentTaskIdRef.current = null;
      const errorMessage = getDetailedErrorMessage(err);
      setError(errorMessage);
      setPipelineError(true);
      setIsPipelineComplete(true);
      setAgentStates(prev => {
        const updated = { ...prev };
        const runningAgent = (Object.keys(updated) as AgentName[]).find(agent => updated[agent].status === 'running');
        if (runningAgent) {
          updated[runningAgent] = {
            ...updated[runningAgent],
            status: 'error',
          };
        }
        return updated;
      });
    }
  }, [clearPolling, handleReportSuccess, reset]);

  const handleStopStreaming = useCallback(() => {
    if (streamController.current) {
      streamController.current.abort();
      setIsStreaming(false);
      logger.log('ChatService', 'WARN', 'Geração de resposta do chat interrompida pelo usuário.');
    }
  }, []);

  const handleSendMessage = useCallback(async (message: string) => {
    if (!chatRef.current) {
      setError('O chat não foi inicializado. Por favor, execute uma análise primeiro.');
      return;
    }

    const userMessage: ChatMessage = { id: Date.now().toString(), sender: 'user', text: message };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    const aiMessageId = (Date.now() + 1).toString();
    let fullAiResponse = '';
    setMessages(prev => [...prev, { id: aiMessageId, sender: 'ai', text: '...' }]);

    streamController.current = new AbortController();
    const signal = streamController.current.signal;

    try {
      const stream = sendMessageStream(chatRef.current, message);
      for await (const chunk of stream) {
        if (signal.aborted) break;
        fullAiResponse += chunk;
        setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: fullAiResponse } : m));
      }

      if (!signal.aborted) {
        try {
          const finalJson = JSON.parse(fullAiResponse);
          setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, ...finalJson } : m));
        } catch(parseError) {
          logger.log('ChatService', 'ERROR', 'Falha ao analisar a resposta JSON final da IA.', { error: parseError, response: fullAiResponse });
          const errorMessage = 'A IA retornou uma resposta em formato inválido. Por favor, tente novamente.';
          setError(errorMessage);
          setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: errorMessage } : m));
        }
      }

    } catch (err: unknown) {
      const finalMessage = getDetailedErrorMessage(err);
      setError(finalMessage);
      setMessages(prev => prev.filter(m => m.id !== aiMessageId)); // Remove placeholder
    } finally {
      setIsStreaming(false);
      streamController.current = null;
    }
  }, []);

  const handleClassificationChange = useCallback(async (docName: string, newClassification: ClassificationResult['operationType']) => {
    if (!auditReport) {
      setError('Nenhum relatório disponível para atualizar a classificação.');
      return;
    }

    const previousReport = auditReport;
    const updatedDocs = auditReport.documents.map(doc => {
      if (doc.doc.name === docName && doc.classification) {
        return {
          ...doc,
          classification: { ...doc.classification, operationType: newClassification, confidence: 1.0 },
        };
      }
      return doc;
    });

    setAuditReport({ ...auditReport, documents: updatedDocs });

    const payload: {
      documentName: string;
      operationType: ClassificationResult['operationType'];
      taskId?: string;
    } = {
      documentName: docName,
      operationType: newClassification,
    };

    if (lastCompletedTaskIdRef.current) {
      payload.taskId = lastCompletedTaskIdRef.current;
    }

    try {
      const response = await fetch('/api/v1/report/correct_classification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Falha ao enviar correção de classificação (${response.status}).`);
      }

      logger.log('Orchestrator', 'INFO', `Correção de classificação enviada para '${docName}'.`);
    } catch (classificationError) {
      setAuditReport(previousReport);
      const detailedMessage = getDetailedErrorMessage(classificationError);
      setError(detailedMessage);
      logger.log('Orchestrator', 'ERROR', 'Falha ao enviar correção de classificação.', { error: classificationError });
    }
  }, [auditReport]);

  return {
    agentStates,
    auditReport,
    setAuditReport,
    messages,
    isStreaming,
    error: error,
    isPipelineRunning: Object.values(agentStates).some(s => s.status === 'running'),
    isPipelineComplete,
    pipelineError,
    runPipeline,
    handleSendMessage,
    handleStopStreaming,
    setError,
    handleClassificationChange,
    reset,
  };
};
