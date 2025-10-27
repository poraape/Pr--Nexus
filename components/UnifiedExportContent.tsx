import React, { useMemo } from 'react';
import dayjs from 'dayjs';
import ReportViewer from './ReportViewer';
import Dashboard from './Dashboard';
import IncrementalInsights from './IncrementalInsights';
import ChatTranscript from './ChatTranscript';
import type { AuditReport, ChatMessage, ClassificationResult } from '../types';

interface UnifiedExportContentProps {
    report: AuditReport;
    history: AuditReport[];
    messages: ChatMessage[];
    onClassificationChange: (docName: string, newClassification: ClassificationResult['operationType']) => void;
}

const UnifiedExportContent: React.FC<UnifiedExportContentProps> = ({
    report,
    history,
    messages,
    onClassificationChange,
}) => {
    const generatedAt = useMemo(() => dayjs().format('DD/MM/YYYY HH:mm:ss'), []);

    return (
        <div className="space-y-10" data-export-title>
            <header className="bg-gray-800 p-6 rounded-lg shadow-lg space-y-4">
                <div>
                    <p className="text-sm text-gray-400 uppercase tracking-widest">
                        Nexus QuantumI2A2 · Exportação Consolidada
                    </p>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300" data-export-title>
                        {report.summary.title}
                    </h1>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-300">
                    <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                        <p className="text-xs text-gray-400 uppercase tracking-wider">Status</p>
                        <p className="font-semibold text-teal-300">Análise Finalizada</p>
                    </div>
                    <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                        <p className="text-xs text-gray-400 uppercase tracking-wider">Documentos Processados</p>
                        <p className="font-semibold">{report.documents.length}</p>
                    </div>
                    <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                        <p className="text-xs text-gray-400 uppercase tracking-wider">Exportado em</p>
                        <p className="font-semibold">{generatedAt}</p>
                    </div>
                </div>
            </header>

            <section className="space-y-6" aria-labelledby="executive-analysis" data-export-title>
                <h2 id="executive-analysis" className="text-2xl font-bold text-gray-100">
                    Análise Executiva Completa
                </h2>
                <ReportViewer report={report} onClassificationChange={onClassificationChange} />
            </section>

            <section className="space-y-6" aria-labelledby="dashboard-analytics" data-export-title>
                <h2 id="dashboard-analytics" className="text-2xl font-bold text-gray-100">
                    Dashboard Analítico
                </h2>
                <Dashboard report={report} />
            </section>

            <section className="space-y-6" aria-labelledby="comparative-analysis" data-export-title>
                <h2 id="comparative-analysis" className="text-2xl font-bold text-gray-100">
                    Análise Comparativa Histórica
                </h2>
                <IncrementalInsights history={history} />
            </section>

            <section className="space-y-6" aria-labelledby="chat-history" data-export-title>
                <h2 id="chat-history" className="text-2xl font-bold text-gray-100">
                    Interações com o Assistente
                </h2>
                <ChatTranscript messages={messages} />
            </section>
        </div>
    );
};

export default UnifiedExportContent;
