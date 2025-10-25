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


    const {
        agentStates,
        auditReport,
        setAuditReport, // from useAgentOrchestrator
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


    const exportableContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isPipelineRunning) {
            setPipelineStep('PROCESSING');
            setActiveView('report'); // Reset to report view on new run
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
            
            if (!exportableContentRef.current) return;
            switch (type) {
                case 'md': await exportToMarkdown(exportableContentRef.current, filename); break;
                case 'html': await exportToHtml(exportableContentRef.current, filename, auditReport.summary.title); break;
                case 'pdf': await exportToPdf(exportableContentRef.current, filename, auditReport.summary.title); break;
                case 'docx': await exportToDocx(exportableContentRef.current, filename, auditReport.summary.title); break;
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
                        <FileUpload onStartAnalysis={handleStartAnalysis} disabled={isPipelineRunning} />
                    </div>
                );
            case 'PROCESSING':
                return (
                    <div className="max-w-4xl mx-auto">
                        <ProgressTracker agentStates={agentStates} />
                    </div>
                );
            case 'COMPLETE':
                if (!auditReport) return null;
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
                        <div className={`flex-col gap-6 lg:gap-8 ${isPanelCollapsed ? 'hidden' : 'flex'}`}>
                            {/* View Switcher */}
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
                            <div ref={exportableContentRef}>
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
                return <PipelineErrorDisplay onReset={handleReset} errorMessage={error} />;
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
        </div>
    );
};

export default App;