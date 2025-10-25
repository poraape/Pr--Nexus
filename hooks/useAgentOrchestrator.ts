import { useState, useCallback, useRef, useEffect } from 'react';
import Papa from 'papaparse';

import { initializeConsultantSession, sendChatMessage, streamChatMessage, type ConsultantHistoryItem } from '../services/chatService';
import { apiFetch } from '../services/httpClient';
import { logger } from '../services/logger';
import type { ChatMessage, AuditReport, ClassificationResult } from '../types';

export type AgentName = 'ocr' | 'auditor' | 'classifier' | 'crossValidator' | 'intelligence' | 'accountant';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'error';
export interface AgentProgress {
  step: string;
  current: number;
  total: number;
}
export type AgentState = { status: AgentStatus; progress: AgentProgress };
export type AgentStates = Record<AgentName, AgentState>;

type BackendAgentProgress = {
  step?: string;
  current?: number;
  total?: number;
};

type BackendAgentState = {
  status?: string;
  progress?: BackendAgentProgress;
};

type TaskStatusResponse = {
  task_id: string;
  status: string;
  progress: number;
  message?: string;
  agents?: Record<string, BackendAgentState>;
};

type UploadResponse = {
  task_id: string;
  status: string;
};

type ReportResponse = {
  task_id: string;
  content: AuditReport;
  generated_at: string;
};

const POLL_INTERVAL_MS = 2500;

const initialAgentStates: AgentStates = {
  ocr: { status: 'pending', progress: { step: 'Aguardando arquivos', current: 0, total: 0 } },
  auditor: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  classifier: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  crossValidator: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  intelligence: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
  accountant: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
};

const getDetailedErrorMessage = (error: unknown): string => {
  logger.log('ErrorHandler', 'ERROR', 'Analisando erro da aplicação.', { error });

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('failed to fetch')) {
      return 'Falha de conexão. Verifique sua internet ou possíveis problemas de CORS.';
    }
    if (message.includes('api key not valid')) {
      return 'Chave de API inválida. Verifique sua configuração.';
    }
    if (message.includes('quota')) {
      return 'Cota da API excedida. Por favor, tente novamente mais tarde.';
    }
    if (message.includes('400')) return 'Requisição inválida para a API. Verifique os dados enviados.';
    if (message.includes('401') || message.includes('permission denied')) return 'Não autorizado. Verifique sua chave de API e permissões.';
    if (message.includes('429')) return 'Muitas requisições. Por favor, aguarde e tente novamente.';
    if (message.includes('500') || message.includes('503')) return 'O serviço de IA está indisponível ou com problemas. Tente novamente mais tarde.';
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
  }

  return 'Ocorreu um erro desconhecido durante a operação.';
};

const normalizeAgentStatus = (status?: string): AgentStatus => {
  const value = status?.toLowerCase() || 'pending';
  if (value.startsWith('error')) return 'error';
  if (value === 'running' || value === 'in_progress') return 'running';
  if (['completed', 'done', 'success'].includes(value)) return 'completed';
  return 'pending';
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
  const [pipelineError, setPipelineError] = useState(false);
  const [isPipelineComplete, setIsPipelineComplete] = useState(false);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);

  const consultantSessionIdRef = useRef<string | null>(null);
  const consultantReadyRef = useRef(false);
  const streamController = useRef<{ close: () => void } | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const mapBackendAgentStates = useCallback((agents?: Record<string, BackendAgentState>) => {
    if (!agents) {
      return;
    }

    setAgentStates(prev => {
      const updated: AgentStates = { ...prev };
      (Object.keys(initialAgentStates) as AgentName[]).forEach(agent => {
        const payload = agents[agent];
        if (payload) {
          updated[agent] = {
            status: normalizeAgentStatus(payload.status),
            progress: mergeProgress(prev[agent].progress, payload.progress),
          };
        }
      });
      return updated;
    });
  }, []);

  const handleReportSuccess = useCallback(async (taskId: string) => {
    try {
      const response = await apiFetch(`/api/v1/report/${taskId}`);
      const payload = (await response.json()) as ReportResponse;
      const finalReport = payload.content;
      setAuditReport(finalReport);
      setPipelineError(false);
      setError(null);
      setIsPipelineComplete(true);
      setIsPipelineRunning(false);
      currentTaskIdRef.current = null;
      lastCompletedTaskIdRef.current = taskId;

      setAgentStates(prev => {
        const completed: AgentStates = { ...prev };
        (Object.keys(completed) as AgentName[]).forEach(agent => {
          if (completed[agent].status !== 'error') {
            completed[agent] = { status: 'completed', progress: completed[agent].progress };
          }
        });
        return completed;
      });

      const validDocsData = finalReport.documents
        ?.filter(d => d.status !== 'ERRO' && d.doc?.data)
        .flatMap(d => d.doc.data ?? []) ?? [];

      const dataSampleForAI = validDocsData.length > 0
        ? Papa.unparse(validDocsData.slice(0, 200))
        : 'Sem dados tabulares disponíveis para amostragem.';

      const sessionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}`;
      consultantSessionIdRef.current = sessionId;

      try {
        await initializeConsultantSession({
          sessionId,
          report: finalReport,
          metadata: {
            aggregated_metrics: finalReport.aggregatedMetrics ?? {},
            summary: finalReport.summary,
            data_sample: dataSampleForAI,
          },
        });
        consultantReadyRef.current = true;
        setMessages([
          {
            id: 'initial-ai-message',
            sender: 'ai',
            text: 'Sua análise fiscal está pronta. Explore os detalhes abaixo ou me faça uma pergunta sobre os dados.',
          },
        ]);
        logger.log('ChatService', 'INFO', 'Consultor fiscal pronto para responder perguntas.');
      } catch (initError) {
        consultantReadyRef.current = false;
        const message = getDetailedErrorMessage(initError);
        logger.log('ChatService', 'ERROR', 'Falha ao preparar consultor fiscal no backend.', { error: initError });
        setMessages([
          {
            id: 'initial-ai-message',
            sender: 'ai',
            text: 'Não foi possível preparar o consultor fiscal. Tente novamente após revisar a configuração.',
          },
        ]);
        setError(message);
      }
    } catch (reportError) {
      const detailedMessage = getDetailedErrorMessage(reportError);
      setPipelineError(true);
      setError(detailedMessage);
      setIsPipelineComplete(true);
      setIsPipelineRunning(false);
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
    consultantSessionIdRef.current = null;
    consultantReadyRef.current = false;
    streamingMessageIdRef.current = null;
    if (streamController.current) {
      streamController.current.close();
      streamController.current = null;
    }
    setIsStreaming(false);
    setIsPipelineComplete(false);
    setIsPipelineRunning(false);
  }, [clearPolling]);

  const pollStatus = useCallback(async () => {
    if (!currentTaskIdRef.current) {
      return;
    }

    try {
      const response = await apiFetch(`/api/v1/status/${currentTaskIdRef.current}`);
      const payload = (await response.json()) as TaskStatusResponse;
      mapBackendAgentStates(payload.agents);

      const normalizedStatus = payload.status.toUpperCase();
      if (normalizedStatus === 'FAILURE') {
        clearPolling();
        setPipelineError(true);
        setIsPipelineComplete(true);
        setIsPipelineRunning(false);
        setError(payload.message || 'Falha no processamento da tarefa.');
        currentTaskIdRef.current = null;
      } else if (normalizedStatus === 'SUCCESS') {
        clearPolling();
        await handleReportSuccess(payload.task_id);
      } else {
        setIsPipelineRunning(true);
      }
    } catch (statusError) {
      const detailedMessage = getDetailedErrorMessage(statusError);
      setError(detailedMessage);
      setPipelineError(true);
      setIsPipelineComplete(true);
      setIsPipelineRunning(false);
      clearPolling();
      logger.log('Orchestrator', 'ERROR', 'Falha ao consultar status da tarefa.', { error: statusError });
    }
  }, [clearPolling, handleReportSuccess, mapBackendAgentStates]);

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

      const response = await apiFetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      });

      const { task_id: taskId } = (await response.json()) as UploadResponse;
      if (!taskId) {
        throw new Error('Resposta do servidor não contém task_id.');
      }

      currentTaskIdRef.current = taskId;
      setIsPipelineRunning(true);
      pollingIntervalRef.current = setInterval(() => {
        void pollStatus();
      }, POLL_INTERVAL_MS);
      await pollStatus();
    } catch (uploadError) {
      const detailedMessage = getDetailedErrorMessage(uploadError);
      setError(detailedMessage);
      setPipelineError(true);
      setIsPipelineRunning(false);
      setIsPipelineComplete(true);
      setAgentStates(prev => ({
        ...prev,
        ocr: { status: 'error', progress: { ...prev.ocr.progress, step: detailedMessage } },
      }));
      logger.log('Orchestrator', 'ERROR', 'Falha ao iniciar pipeline no backend.', { error: uploadError });
    }
  }, [pollStatus, reset]);

  const handleStopStreaming = useCallback(() => {
    if (streamController.current) {
      streamController.current.close();
      streamController.current = null;
      setIsStreaming(false);
      const interruptedId = streamingMessageIdRef.current;
      streamingMessageIdRef.current = null;
      if (interruptedId) {
        setMessages(prev => prev.map(m => m.id === interruptedId ? { ...m, text: 'Resposta interrompida pelo usuário.' } : m));
      }
      logger.log('ChatService', 'WARN', 'Geração de resposta do chat interrompida pelo usuário.');
    }
  }, []);

  const handleSendMessage = useCallback(async (message: string) => {
    if (!consultantReadyRef.current || !consultantSessionIdRef.current) {
      setError('O consultor fiscal ainda não está pronto. Execute uma análise primeiro.');
      return;
    }

    const sessionId = consultantSessionIdRef.current;
    const userMessage: ChatMessage = { id: Date.now().toString(), sender: 'user', text: message };
    const aiMessageId = `${Date.now()}-ai`;
    const history: ConsultantHistoryItem[] = [...messages, userMessage]
      .filter(m => m.sender === 'user' || m.sender === 'ai')
      .map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
        chartData: m.chartData,
      }));

    setMessages(prev => [...prev, userMessage, { id: aiMessageId, sender: 'ai', text: '...' }]);
    setIsStreaming(true);
    setError(null);
    streamingMessageIdRef.current = aiMessageId;

    const supportsStreaming = typeof EventSource !== 'undefined';

    if (!supportsStreaming) {
      try {
        const response = await sendChatMessage({ sessionId, question: message, history, stream: false });
        setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: response.text, chartData: response.chartData ?? undefined } : m));
      } catch (err) {
        const errorMessage = getDetailedErrorMessage(err);
        setError(errorMessage);
        setMessages(prev => prev.filter(m => m.id !== aiMessageId));
      } finally {
        streamingMessageIdRef.current = null;
        setIsStreaming(false);
      }
      return;
    }

    let fullResponse = '';
    try {
      const controller = streamChatMessage(
        { sessionId, question: message, history },
        {
          onChunk: (chunk) => {
            fullResponse += chunk;
            setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: fullResponse || '...' } : m));
          },
          onFinal: (finalMessage) => {
            streamingMessageIdRef.current = null;
            setMessages(prev => prev.map(m => m.id === aiMessageId ? {
              ...m,
              text: finalMessage.text,
              chartData: finalMessage.chartData ?? undefined,
            } : m));
            setIsStreaming(false);
            streamController.current = null;
          },
          onError: (messageError) => {
            streamingMessageIdRef.current = null;
            setError(messageError);
            setMessages(prev => prev.filter(m => m.id !== aiMessageId));
            setIsStreaming(false);
            streamController.current = null;
          },
        }
      );
      streamController.current = controller;
    } catch (err) {
      streamingMessageIdRef.current = null;
      const errorMessage = getDetailedErrorMessage(err);
      setError(errorMessage);
      setMessages(prev => prev.filter(m => m.id !== aiMessageId));
      setIsStreaming(false);
      if (streamController.current) {
        streamController.current.close();
        streamController.current = null;
      }
    }
  }, [messages]);

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

    if (!lastCompletedTaskIdRef.current) {
      logger.log('Orchestrator', 'WARN', 'Tentativa de corrigir classificação sem task concluída.');
      return;
    }

    try {
      await apiFetch(`/api/v1/report/${lastCompletedTaskIdRef.current}/classification`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentName: docName,
          operationType: newClassification,
        }),
      });
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
    error,
    isPipelineRunning,
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
