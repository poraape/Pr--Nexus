import React, { useState } from 'react';
import type { AuditReport, AuditedDocument, AuditStatus, ClassificationResult, AccountingEntry, AIDrivenInsight, AIFindingSeverity } from '../types';
import { 
    MetricIcon, 
    InsightIcon, 
    ShieldCheckIcon, 
    ShieldExclamationIcon, 
    ChevronDownIcon,
    FileIcon,
    AiIcon
} from './icons';

const statusStyles: { [key in AuditStatus]: { badge: string; icon: React.ReactNode; text: string; } } = {
    OK: {
        badge: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
        icon: <ShieldCheckIcon className="w-5 h-5 text-teal-400" />,
        text: 'OK'
    },
    ALERTA: {
        badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
        icon: <ShieldExclamationIcon className="w-5 h-5 text-yellow-400" />,
        text: 'Alerta'
    },
    ERRO: {
        badge: 'bg-red-500/20 text-red-300 border-red-500/30',
        icon: <ShieldExclamationIcon className="w-5 h-5 text-red-400" />,
        text: 'Erro'
    }
};

const classificationOptions: ClassificationResult['operationType'][] = [
    'Compra', 'Venda', 'Devolução', 'Serviço', 'Transferência', 'Outros'
];

const classificationStyles: { [key in ClassificationResult['operationType']]: string } = {
    Compra: 'bg-blue-500/30 text-blue-300',
    Venda: 'bg-green-500/30 text-green-300',
    Devolução: 'bg-orange-500/30 text-orange-300',
    Serviço: 'bg-purple-500/30 text-purple-300',
    Transferência: 'bg-indigo-500/30 text-indigo-300',
    Outros: 'bg-gray-500/30 text-gray-300',
};

const severityStyles: Record<AIFindingSeverity, string> = {
    INFO: 'border-l-sky-500',
    BAIXA: 'border-l-yellow-500',
    MÉDIA: 'border-l-orange-500',
    ALTA: 'border-l-red-500',
};


const DocumentItem: React.FC<{ item: AuditedDocument, onClassificationChange: (docName: string, newClassification: ClassificationResult['operationType']) => void }> = ({ item, onClassificationChange }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const { doc, status, score, inconsistencies, classification } = item;
    const style = statusStyles[status];

    const hasDetails = inconsistencies.length > 0;

    const scoreColor = score === 0 ? 'text-teal-400' : score && score > 0 && score <= 5 ? 'text-yellow-400' : 'text-red-400';

    const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        e.stopPropagation(); // Prevent collapsing the item
        onClassificationChange(doc.name, e.target.value as ClassificationResult['operationType']);
    };

    return (
        <div className="bg-gray-700/50 rounded-lg">
            <div 
                className={`flex items-center p-3 ${hasDetails ? 'cursor-pointer' : ''} flex-wrap sm:flex-nowrap gap-2`}
                onClick={() => hasDetails && setIsExpanded(!isExpanded)}
            >
                {style.icon}
                <span className="truncate mx-3 flex-1 text-gray-300 text-sm order-1 sm:order-none w-full sm:w-auto">{doc.name}</span>
                <div className="flex items-center gap-2 ml-auto order-2 sm:order-none">
                     {classification ? (
                         <select
                            value={classification.operationType}
                            onChange={handleSelectChange}
                            onClick={(e) => e.stopPropagation()}
                            className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap border-none appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${classificationStyles[classification.operationType]}`}
                            title="Corrigir classificação"
                         >
                            {classificationOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                         </select>
                    ) : (
                        doc.status !== 'error' && doc.status !== 'unsupported' && <span className="text-xs text-gray-500">N/A</span>
                    )}
                    
                    {score !== undefined && (
                        <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap ${scoreColor}`}>
                           Score: {score}
                        </span>
                    )}
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${style.badge}`}>
                        {style.text}
                    </span>
                    {hasDetails && (
                        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                    )}
                </div>
            </div>
            {isExpanded && hasDetails && (
                 <div className="border-t border-gray-600/50 p-4 animate-fade-in-down">
                    <h5 className="font-semibold text-sm mb-2 text-gray-300">Inconsistências Encontradas:</h5>
                    <ul className="space-y-3">
                        {inconsistencies.map((inc, index) => (
                             <li key={index} className="text-xs border-l-2 border-yellow-500/50 pl-3">
                                <p className="font-semibold text-yellow-300">{inc.message} <span className="text-gray-500 font-mono">({inc.code})</span></p>
                                <p className="text-gray-400 mt-1">
                                    <span className="font-semibold">XAI:</span> {inc.explanation}
                                </p>
                                {inc.normativeBase && (
                                    <p className="text-gray-500 mt-1">
                                        <span className="font-semibold">Base Normativa:</span> {inc.normativeBase}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                 </div>
            )}
        </div>
    );
};

const AccountingEntriesViewer: React.FC<{ entries: AccountingEntry[] }> = ({ entries }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    if (!entries || entries.length === 0) {
        return null;
    }

    return (
        <div>
            <div onClick={() => setIsExpanded(!isExpanded)} className="flex justify-between items-center cursor-pointer">
                <h2 className="text-xl font-bold text-gray-200">Lançamentos Contábeis Sugeridos</h2>
                <ChevronDownIcon className={`w-6 h-6 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
            </div>
            {isExpanded && (
                 <div className="mt-4 animate-fade-in-down">
                    <div className="bg-gray-700/30 rounded-lg max-h-96 overflow-y-auto pr-2">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-400 uppercase bg-gray-700/50 sticky top-0">
                                <tr>
                                    <th scope="col" className="px-4 py-2">Documento</th>
                                    <th scope="col" className="px-4 py-2">Conta Contábil</th>
                                    <th scope="col" className="px-4 py-2 text-center">Débito (D)</th>
                                    <th scope="col" className="px-4 py-2 text-center">Crédito (C)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((entry, index) => (
                                    <tr key={index} className="border-b border-gray-700/50 hover:bg-gray-600/20">
                                        <td className="px-4 py-2 text-gray-400 truncate max-w-xs">{entry.docName}</td>
                                        <td className="px-4 py-2 text-gray-300">{entry.account}</td>
                                        <td className="px-4 py-2 text-right font-mono text-green-400">
                                            {entry.type === 'D' ? entry.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}
                                        </td>
                                        <td className="px-4 py-2 text-right font-mono text-red-400">
                                            {entry.type === 'C' ? entry.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};


const ReportViewer: React.FC<{ report: AuditReport, onClassificationChange: (docName: string, newClassification: ClassificationResult['operationType']) => void }> = ({ report, onClassificationChange }) => {
  const { summary, documents, accountingEntries, aiDrivenInsights } = report;

  const docStats = documents.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
  }, {} as Record<AuditStatus, number>);

  const averageScore = (documents.reduce((acc, doc) => acc + (doc.score ?? 0), 0) / (documents.length || 1)).toFixed(1);


  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg animate-fade-in space-y-8">
      {/* Executive Summary Section */}
      <div>
        <h2 className="text-xl font-bold text-gray-200 mb-4">Análise Executiva</h2>
        <div className="text-gray-300 space-y-6">
            <h3 data-export-title className="text-lg font-semibold text-blue-400">{summary.title}</h3>
            <p className="text-sm leading-relaxed">{summary.summary}</p>
            <div>
            <h4 className="flex items-center text-md font-semibold text-gray-300 mb-3"><MetricIcon className="w-5 h-5 mr-2 text-gray-400"/>Métricas Chave</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4">
                {summary.keyMetrics.map((item, index) => (
                <div key={index} className="bg-gray-700/50 p-4 rounded-md">
                    <p className="font-bold text-lg text-teal-300">{item.value}</p>
                    <p className="text-sm font-semibold text-gray-300">{item.metric}</p>
                    <p className="text-xs text-gray-400 mt-1">{item.insight}</p>
                </div>
                ))}
            </div>
            </div>
            <div>
            <h4 className="flex items-center text-md font-semibold text-gray-300 mb-3"><InsightIcon className="w-5 h-5 mr-2 text-gray-400"/>Insights Acionáveis</h4>
            <ul className="list-disc list-inside space-y-2 text-sm">
                {summary.actionableInsights.map((item, index) => (
                <li key={index}>{item}</li>
                ))}
            </ul>
            </div>
             {summary.strategicRecommendations && summary.strategicRecommendations.length > 0 && (
                <div className="bg-sky-900/50 border border-sky-700 p-4 rounded-lg">
                    <h4 className="flex items-center text-md font-semibold text-sky-300 mb-3">
                        <AiIcon className="w-5 h-5 mr-2"/>
                        Recomendações Estratégicas (IA)
                    </h4>
                    <ul className="list-disc list-inside space-y-2 text-sm text-sky-200">
                        {summary.strategicRecommendations.map((item, index) => (
                        <li key={index}>{item}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
      </div>

      {/* AI Driven Insights Section */}
      {aiDrivenInsights && aiDrivenInsights.length > 0 && (
        <div>
            <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Insights Gerados por IA</h2>
            <div className="space-y-3">
            {aiDrivenInsights.map((insight, index) => (
                <div key={index} className={`bg-gray-700/50 p-4 rounded-lg border-l-4 ${severityStyles[insight.severity]}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="font-semibold text-gray-200">{insight.category}</p>
                            <p className="text-sm text-gray-400 mt-1">{insight.description}</p>
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md`}>{insight.severity}</span>
                    </div>
                    {insight.evidence && insight.evidence.length > 0 && (
                        <p className="text-xs text-gray-500 mt-2">
                            <span className="font-semibold">Evidências:</span> {insight.evidence.join(', ')}
                        </p>
                    )}
                </div>
            ))}
            </div>
        </div>
      )}
      
      {/* Detailed Document Analysis Section */}
      <div>
         <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Detalhes por Documento</h2>
         <div className="bg-gray-700/30 p-4 rounded-lg mb-4 flex justify-around items-center text-center flex-wrap gap-4">
            <div className="text-gray-300"><span className="text-2xl font-bold">{documents.length}</span><br/><span className="text-xs">Total</span></div>
            <div className="text-teal-300"><span className="text-2xl font-bold">{docStats.OK || 0}</span><br/><span className="text-xs">OK</span></div>
            <div className="text-yellow-300"><span className="text-2xl font-bold">{docStats.ALERTA || 0}</span><br/><span className="text-xs">Alertas</span></div>
            <div className="text-red-300"><span className="text-2xl font-bold">{docStats.ERRO || 0}</span><br/><span className="text-xs">Erros</span></div>
            <div className="text-blue-300"><span className="text-2xl font-bold">{averageScore}</span><br/><span className="text-xs">Score Médio</span></div>
         </div>
         <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
            {documents.map((item, index) => (
                <DocumentItem key={`${item.doc.name}-${index}`} item={item} onClassificationChange={onClassificationChange} />
            ))}
         </div>
      </div>

       {/* Accounting Entries Section */}
      {accountingEntries && accountingEntries.length > 0 && (
        <div className="border-t border-gray-700 pt-8">
            <AccountingEntriesViewer entries={accountingEntries} />
        </div>
      )}
    </div>
  );
};

export default ReportViewer;