import { useState, useCallback, useRef, useEffect } from 'react';
import { importFiles } from '../utils/importPipeline';
import { runAudit } from '../agents/auditorAgent';
import { runClassification } from '../agents/classifierAgent';
import { runIntelligenceAnalysis } from '../agents/intelligenceAgent';
import { runAccountingAnalysis } from '../agents/accountantAgent';
import { initializeConsultantSession, sendChatMessage, streamChatMessage, type ConsultantHistoryItem } from '../services/chatService';
import type { ChatMessage, ImportedDoc, AuditReport, ClassificationResult } from '../types';
import Papa from 'papaparse';
import { logger } from '../services/logger';
import { runDeterministicCrossValidation } from '../utils/fiscalCompare';

export type AgentName = 'ocr' | 'auditor' | 'classifier' | 'crossValidator' | 'intelligence' | 'accountant';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'error';
export interface AgentProgress {
  step: string;
  current: number;
  total: number;
}
export type AgentState = { status: AgentStatus; progress: AgentProgress; };
export type AgentStates = Record<AgentName, AgentState>;
type ClassificationCorrections = Record<string, ClassificationResult['operationType']>;


const initialAgentStates: AgentStates = {
    ocr: { status: 'pending', progress: { step: 'Aguardando arquivos', current: 0, total: 0 } },
    auditor: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    classifier: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    crossValidator: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    intelligence: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
    accountant: { status: 'pending', progress: { step: '', current: 0, total: 0 } },
};

const CORRECTIONS_STORAGE_KEY = 'nexus-classification-corrections';

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


const extractTextPreviewFromJson = (raw: string): string => {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.text === 'string') {
            return parsed.text;
        }
    } catch (_) {
        // Ignore JSON parse errors for partial content.
    }

    const textMatch = raw.match(/"text"\s*:\s*"([\s\S]*)$/);
    if (textMatch && textMatch[1]) {
        return textMatch[1]
            .replace(/"\s*,\s*"chartData[\s\S]*/g, '')
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"');
    }

    return raw.replace(/\\n/g, '\n');
};


export const useAgentOrchestrator = () => {
    const [agentStates, setAgentStates] = useState<AgentStates>(initialAgentStates);
    const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pipelineError, setPipelineError] = useState<boolean>(false);
    const [isPipelineComplete, setIsPipelineComplete] = useState(false);
    const [classificationCorrections, setClassificationCorrections] = useState<ClassificationCorrections>({});

    const consultantSessionIdRef = useRef<string | null>(null);
    const consultantReadyRef = useRef<boolean>(false);
    const streamController = useRef<{ close: () => void } | null>(null);
    const streamingMessageIdRef = useRef<string | null>(null);
    
    // Load corrections from localStorage on initial mount
    useEffect(() => {
        try {
            const storedCorrections = localStorage.getItem(CORRECTIONS_STORAGE_KEY);
            if (storedCorrections) {
                setClassificationCorrections(JSON.parse(storedCorrections));
                logger.log('Orchestrator', 'INFO', `Carregadas ${Object.keys(JSON.parse(storedCorrections)).length} correções de classificação do localStorage.`);
            }
        } catch (e) {
            logger.log('Orchestrator', 'ERROR', 'Falha ao carregar correções do localStorage.', { error: e });
        }
    }, []);
    
    const reset = useCallback(() => {
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
        setIsPipelineComplete(false);
    }, []);

    const runPipeline = useCallback(async (files: File[]) => {
        logger.log('Orchestrator', 'INFO', 'Iniciando novo pipeline de análise.');
        // Don't clear logs on incremental runs, just reset pipeline state
        reset();
        
        const updateAgentState = (agent: AgentName, status: AgentStatus, progress?: Partial<AgentProgress>) => {
            setAgentStates(prev => {
                const newState = { ...prev, [agent]: { status, progress: { ...prev[agent].progress, ...progress } } };
                if(status === 'running') logger.log(agent, 'INFO', `Iniciando - ${progress?.step || ''}`);
                if(status === 'completed') logger.log(agent, 'INFO', `Concluído.`);
                return newState;
            });
        };
        
        try {

            // 1. Agente OCR / NLP
            updateAgentState('ocr', 'running', { step: 'Processando arquivos...' });
            const importedDocs = await importFiles(files, (current, total) => {
                updateAgentState('ocr', 'running', { step: 'Processando arquivos...', current, total });
            });
            updateAgentState('ocr', 'completed');
            
            const isSingleZip = files.length === 1 && (files[0].name.toLowerCase().endsWith('.zip') || files[0].type.includes('zip'));
            const hasValidDocs = importedDocs.some(d => d.status !== 'unsupported' && d.status !== 'error');

            if (!hasValidDocs) {
                let errorMessage = "Nenhum arquivo válido foi processado. Verifique os formatos.";
            
                // If there's only one processed document (from a single file upload or a zip with one file)
                // and it has an error, use its specific error message for better feedback.
                if (importedDocs.length === 1 && importedDocs[0].error) {
                    errorMessage = importedDocs[0].error;
                } 
                // Fallback for a single zip that might have produced multiple error docs or an empty result.
                else if (isSingleZip) {
                    errorMessage = "O arquivo ZIP está vazio ou não contém arquivos com formato suportado.";
                }
            
                throw new Error(errorMessage);
            }
            
            // 2. Agente Auditor
            updateAgentState('auditor', 'running', { step: `Validando ${importedDocs.length} documentos...` });
            const auditedReport = await runAudit(importedDocs);
            updateAgentState('auditor', 'completed');

            // 3. Agente Classificador
            updateAgentState('classifier', 'running', { step: 'Classificando operações...' });
            const classifiedReport = await runClassification(auditedReport, classificationCorrections);
            updateAgentState('classifier', 'completed');

            // 4. Agente Validador Cruzado (Determinístico)
            updateAgentState('crossValidator', 'running', { step: 'Executando validação cruzada...' });
            const deterministicCrossValidation = await runDeterministicCrossValidation(classifiedReport);
            const reportWithCrossValidation = { ...classifiedReport, deterministicCrossValidation };
            updateAgentState('crossValidator', 'completed');

            // 5. Agente de Inteligência (IA)
            updateAgentState('intelligence', 'running', { step: 'Analisando padrões com IA...' });
            const { aiDrivenInsights, crossValidationResults } = await runIntelligenceAnalysis(reportWithCrossValidation);
            updateAgentState('intelligence', 'completed');

            // 6. Agente Contador
            updateAgentState('accountant', 'running', { step: 'Gerando análise com IA...' });
            const finalReport = await runAccountingAnalysis({ ...reportWithCrossValidation, aiDrivenInsights, crossValidationResults });
            setAuditReport(finalReport);
            updateAgentState('accountant', 'completed');
            
            const validDocsData = finalReport.documents
                .filter(d => d.status !== 'ERRO' && d.doc.data)
                .flatMap(d => d.doc.data!);
            const dataSampleForAI = Papa.unparse(validDocsData.slice(0, 200));

            // 7. Preparar para Chat
            logger.log('ChatService', 'INFO', 'Inicializando consultor fiscal no backend.');
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

        } catch (err: unknown) {
            console.error('Pipeline failed:', err);
            const errorMessage = getDetailedErrorMessage(err);
            setError(errorMessage);
            setPipelineError(true);
             const runningAgent = (Object.keys(agentStates) as AgentName[]).find(a => agentStates[a].status === 'running');
             if(runningAgent) {
                updateAgentState(runningAgent, 'error');
             }
        } finally {
            setIsPipelineComplete(true);
        }
    }, [classificationCorrections]); // Added dependency

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
                        const preview = extractTextPreviewFromJson(fullResponse);
                        setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: preview || '...' } : m));
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

    const handleClassificationChange = useCallback((docName: string, newClassification: ClassificationResult['operationType']) => {
        setAuditReport(prevReport => {
            if (!prevReport) return null;
            const updatedDocs = prevReport.documents.map(doc => {
                if (doc.doc.name === docName && doc.classification) {
                    return {
                        ...doc,
                        classification: { ...doc.classification, operationType: newClassification, confidence: 1.0 }
                    };
                }
                return doc;
            });
            return { ...prevReport, documents: updatedDocs };
        });
        
        // Update and save corrections for future runs
        const newCorrections = { ...classificationCorrections, [docName]: newClassification };
        setClassificationCorrections(newCorrections);
        try {
            localStorage.setItem(CORRECTIONS_STORAGE_KEY, JSON.stringify(newCorrections));
            logger.log('Orchestrator', 'INFO', `Correção de classificação para '${docName}' salva.`);
        } catch(e) {
            logger.log('Orchestrator', 'ERROR', `Falha ao salvar correção no localStorage.`, { error: e });
            setError('Não foi possível salvar a correção de classificação. Ela será perdida ao recarregar a página.');
        }

    }, [classificationCorrections]);

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