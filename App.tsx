import React, { useRef, useState, useEffect } from 'react';
import FileUpload from './components/FileUpload';
import ReportViewer from './components/ReportViewer';
import ChatPanel from './components/ChatPanel';
import Header from './components/Header';
import Toast from './components/Toast';
import ProgressTracker from './components/ProgressTracker';
import PipelineErrorDisplay from './components/PipelineErrorDisplay';
import { useAgentOrchestrator } from './hooks/useAgentOrchestrator';
import { exportToMarkdown, exportToHtml, exportToPdf, exportToDocx, exportToJson, exportToXlsx } from './utils/exportUtils';
import LogsPanel from './components/LogsPanel';
import Dashboard from './components/Dashboard';
import type { AuditReport } from './types';
import IncrementalInsights from './components/IncrementalInsights';
import UnifiedExportContent from './components/UnifiedExportContent';
import { analysisService, DynamicAnalysisResult } from './services/analysisService';
import DynamicAnalysisDisplay from './components/DynamicAnalysisDisplay';
import { LoadingSpinnerIcon } from './components/icons';

export type ExportType = 'md' | 'html' | 'pdf' | 'docx' | 'sped' | 'xlsx' | 'json';
type PipelineStep = 'UPLOAD' | 'PROCESSING' | 'COMPLETE' | 'ERROR';
type ActiveView = 'report' | 'dashboard' | 'comparative';

const App: React.FC = () => {
    const [isExporting, setIsExporting] = useState<ExportType | null>(null);
    const [pipelineStep, setPipelineStep] = useState<PipelineStep>('UPLOAD');
    const [showLogs, setShowLogs] = useState(false);
    const [activeView, setActiveView] = useState<ActiveView>('report');
    const [analysisHistory, setAnalysisHistory] = useState<AuditReport[]>([]);
    const [processedFiles, setProcessedFiles] = useState<File[]>([]);
    const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

    // State for new dynamic analysis
    const [dynamicAnalysisResult, setDynamicAnalysisResult] = useState<DynamicAnalysisResult | null>(null);
    const [isDynamicAnalysisLoading, setIsDynamicAnalysisLoading] = useState<boolean>(false);
    const [dynamicAnalysisError, setDynamicAnalysisError] = useState<string | null>(null);

    const {
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
        reset: resetOrchestrator,
    } = useAgentOrchestrator();

    useEffect(() => {
        if (auditReport) {
            setAnalysisHistory(prev => [...prev, auditReport]);
        }
    }, [auditReport]);

    const exportContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isPipelineRunning) {
            setPipelineStep('PROCESSING');
            setActiveView('report');
        }
    }, [isPipelineRunning]);

    useEffect(() => {
        if (isPipelineComplete) {
            setPipelineStep(pipelineError ? 'ERROR' : 'COMPLETE');
        }
    }, [isPipelineComplete, pipelineError]);

    const handleStartAnalysis = (files: File[]) => {
        setIsPanelCollapsed(false);
        setProcessedFiles(files);
        runPipeline(files);
    };

    const handleStartDynamicAnalysis = async (file: File) => {
        setIsDynamicAnalysisLoading(true);
        setDynamicAnalysisError(null);
        setDynamicAnalysisResult(null);
        setPipelineStep('PROCESSING');

        try {
            const result = await analysisService.analyzeFile(file);
            setDynamicAnalysisResult(result);
            setPipelineStep('COMPLETE');
        } catch (err: any) {
            setDynamicAnalysisError(err.message || 'Ocorreu um erro desconhecido durante a análise dinâmica.');
            setPipelineStep('ERROR');
        } finally {
            setIsDynamicAnalysisLoading(false);
        }
    };

    const handleIncrementalUpload = (newFiles: File[]) => {
        const uniqueNewFiles = newFiles.filter(
            (newFile) => !processedFiles.some((processedFile) => processedFile.name === newFile.name)
        );

        if (uniqueNewFiles.length === 0 && newFiles.length > 0) {
            setError("Todos os arquivos selecionados já foram incluídos na análise atual.");
            return;
        }
        
        if (uniqueNewFiles.length === 0) return;

        const allFiles = [...processedFiles, ...uniqueNewFiles];
        setProcessedFiles(allFiles);
        runPipeline(allFiles);
    };

    const handleReset = () => {
        setIsPanelCollapsed(false);
        setPipelineStep('UPLOAD');
        setError(null);
        setAnalysisHistory([]);
        setAuditReport(null);
        setProcessedFiles([]);
        resetOrchestrator();
        // Reset dynamic analysis state
        setDynamicAnalysisResult(null);
        setDynamicAnalysisError(null);
        setIsDynamicAnalysisLoading(false);
    };

    const handleExport = async (type: ExportType) => {
        if (!auditReport) return;
        setIsExporting(type);
        try {
            const filename = auditReport.summary.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            
            if (type === 'sped') {
                 if(auditReport.spedFile) {
                    const blob = new Blob([auditReport.spedFile.content], { type: 'text/plain;charset=utf-8' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = auditReport.spedFile.filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                 } else {
                    throw new Error("Arquivo SPED não foi gerado.");
                 }
                 return;
            }

            if (type === 'json') {
                await exportToJson(auditReport, filename);
                return;
            }
    
            if (type === 'xlsx') {
                await exportToXlsx(auditReport, filename);
                return;
            }
            
            if (!exportContentRef.current) {
                throw new Error('Elemento de exportação não encontrado.');
            }
            const exportTarget = exportContentRef.current;
            switch (type) {
                case 'md': await exportToMarkdown(exportTarget, filename); break;
                case 'html': await exportToHtml(exportTarget, filename, auditReport.summary.title); break;
                case 'pdf': await exportToPdf(exportTarget, filename, auditReport.summary.title); break;
                case 'docx': await exportToDocx(exportTarget, filename, auditReport.summary.title); break;
            }
        } catch (exportError) {
            console.error(`Failed to export as ${type}:`, exportError);
            setError(`Falha ao exportar como ${type.toUpperCase()}.`);
        } finally {
            setIsExporting(null);
        }
    };
    
    const renderContent = () => {
        switch (pipelineStep) {
            case 'UPLOAD':
                return (
                    <div className="max-w-2xl mx-auto">
                        <FileUpload 
                            onStartAnalysis={handleStartAnalysis} 
                            onStartDynamicAnalysis={handleStartDynamicAnalysis}
                            disabled={isPipelineRunning || isDynamicAnalysisLoading} 
                        />
                    </div>
                );
            case 'PROCESSING':
                if (isDynamicAnalysisLoading) {
                    return (
                        <div className="flex flex-col items-center justify-center text-center text-gray-400">
                            <LoadingSpinnerIcon className="w-12 h-12 animate-spin text-blue-500" />
                            <p className="mt-4 text-lg font-semibold">Analisando documento...</p>
                            <p className="text-sm">Aguarde enquanto a IA processa e interpreta o arquivo.</p>
                        </div>
                    );
                }
                return (
                    <div className="max-w-4xl mx-auto">
                        <ProgressTracker agentStates={agentStates} />
                    </div>
                );
            case 'COMPLETE':
                if (dynamicAnalysisResult) {
                    return (
                        <div className="max-w-4xl mx-auto">
                            <DynamicAnalysisDisplay result={dynamicAnalysisResult} />
                        </div>
                    );
                }
                if (!auditReport) return null;
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
                        <div className={`flex-col gap-6 lg:gap-8 ${isPanelCollapsed ? 'hidden' : 'flex'}`}>
                            <div className="flex items-center gap-2 bg-gray-800 p-1.5 rounded-lg">
                                <button onClick={() => setActiveView('report')} className={`flex-1 py-2 px-4 rounded-md text-sm font-semibold transition-colors ${activeView === 'report' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}>
                                    Relatório de Análise
                                </button>
                                <button onClick={() => setActiveView('dashboard')} className={`flex-1 py-2 px-4 rounded-md text-sm font-semibold transition-colors ${activeView === 'dashboard' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}>
                                    Dashboard
                                </button>
                                {analysisHistory.length > 1 && (
                                    <button onClick={() => setActiveView('comparative')} className={`flex-1 py-2 px-4 rounded-md text-sm font-semibold transition-colors ${activeView === 'comparative' ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}>
                                       Análise Comparativa
                                    </button>
                                )}
                            </div>
                            <div>
                                {activeView === 'report' ? (
                                    <ReportViewer
                                        report={auditReport}
                                        onClassificationChange={handleClassificationChange}
                                    />
                                ) : activeView === 'dashboard' ? (
                                    <Dashboard report={auditReport} />
                                ) : (
                                    <IncrementalInsights history={analysisHistory} />
                                )}
                            </div>
                        </div>
                        <div className={`lg:sticky lg:top-24 transition-all duration-300 ${isPanelCollapsed ? 'lg:col-span-2 max-w-4xl mx-auto w-full' : ''}`}>
                            <ChatPanel
                                messages={messages}
                                onSendMessage={handleSendMessage}
                                isStreaming={isStreaming}
                                onStopStreaming={handleStopStreaming}
                                reportTitle={auditReport.summary.title}
                                setError={setError}
                                onAddFiles={handleIncrementalUpload}
                            />
                        </div>
                    </div>
                );
            case 'ERROR':
                const errorMessage = dynamicAnalysisError || error;
                return <PipelineErrorDisplay onReset={handleReset} errorMessage={errorMessage} />;
            default:
                return null;
        }
    };
    
    return (
        <div className="bg-gray-900 text-white min-h-screen font-sans">
            <Header
                onReset={handleReset}
                showExports={pipelineStep === 'COMPLETE' && !!auditReport}
                showSpedExport={pipelineStep === 'COMPLETE' && !!auditReport?.spedFile}
                onExport={handleExport}
                isExporting={isExporting}
                onToggleLogs={() => setShowLogs(!showLogs)}
                isPanelCollapsed={isPanelCollapsed}
                onTogglePanel={() => setIsPanelCollapsed(!isPanelCollapsed)}
            />
            <main className="container mx-auto p-4 md:p-6 lg:p-8">
                {renderContent()}
            </main>
            {error && pipelineStep !== 'ERROR' && <Toast message={error} onClose={() => { setError(null); }} />}
            {showLogs && <LogsPanel onClose={() => setShowLogs(false)} />}
            <div
                ref={exportContentRef}
                data-export-root
                aria-hidden="true"
                style={{
                    position: 'fixed',
                    inset: 0,
                    pointerEvents: 'none',
                    opacity: 0,
                    zIndex: -1,
                    overflow: 'auto',
                }}
            >
                {auditReport && (
                    <div className="min-h-screen bg-gray-900 text-white p-8 space-y-10">
                        <UnifiedExportContent
                            report={auditReport}
                            history={analysisHistory}
                            messages={messages}
                            onClassificationChange={handleClassificationChange}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;