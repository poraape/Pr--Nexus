import React from 'react';
import type { DynamicAnalysisResult } from '../services/analysisService';
import { FileInfoIcon, InsightIcon, DocumentTextIcon, CheckIcon } from './icons';
import Chart from './Chart';

interface DynamicAnalysisDisplayProps {
  result: DynamicAnalysisResult;
}

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="bg-gray-800/50 p-4 rounded-lg">
    <h3 className="text-md font-semibold text-blue-300 mb-3 flex items-center">
      {icon}
      <span className="ml-2">{title}</span>
    </h3>
    {children}
  </div>
);

const DynamicAnalysisDisplay: React.FC<DynamicAnalysisDisplayProps> = ({ result }) => {
  const { analysis_summary, data_schema, key_insights, visualizations, full_content_preview } = result;

  return (
    <div className="bg-gray-900 p-6 rounded-lg shadow-lg animate-fade-in space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold text-gray-200">Análise Dinâmica do Documento</h2>
          <p className="text-sm text-gray-400">Análise semântica e contextual realizada por IA</p>
        </div>
        <span className="text-xs font-medium bg-green-800/50 text-green-300 border border-green-700/50 px-2 py-1 rounded-full flex items-center">
          <CheckIcon className="w-4 h-4 mr-1" />
          Concluído
        </span>
      </div>

      {/* Resumo da Análise */}
      <Section title="Resumo da Análise" icon={<FileInfoIcon className="w-5 h-5" />}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-gray-700/50 p-3 rounded-md">
            <p className="text-xs text-gray-400">Nome do Arquivo</p>
            <p className="font-semibold text-gray-200 truncate">{analysis_summary.file_name}</p>
          </div>
          <div className="bg-gray-700/50 p-3 rounded-md">
            <p className="text-xs text-gray-400">Tipo</p>
            <p className="font-semibold text-gray-200">{analysis_summary.file_type}</p>
          </div>
          <div className="bg-gray-700/50 p-3 rounded-md">
            <p className="text-xs text-gray-400">Idioma</p>
            <p className="font-semibold text-gray-200">{analysis_summary.language}</p>
          </div>
          <div className="bg-gray-700/50 p-3 rounded-md">
            <p className="text-xs text-gray-400">Estruturado</p>
            <p className={`font-semibold ${data_schema.is_structured ? 'text-green-400' : 'text-yellow-400'}`}>
              {data_schema.is_structured ? 'Sim' : 'Não'}
            </p>
          </div>
        </div>
        <p className="text-sm text-gray-300 mt-4 bg-gray-700/50 p-3 rounded-md">{analysis_summary.executive_summary}</p>
      </Section>

      {/* Insights Chave */}
      {key_insights && key_insights.length > 0 && (
        <Section title="Insights Chave" icon={<InsightIcon className="w-5 h-5" />}>
          <ul className="space-y-3">
            {key_insights.map((insight, index) => (
              <li key={index} className="bg-gray-700/50 p-3 rounded-md text-sm">
                <p className="font-semibold text-teal-300">{insight.insight_type}</p>
                <p className="text-gray-300">{insight.description}</p>
                {insight.related_data && (
                  <p className="text-xs text-gray-400 mt-1 font-mono bg-gray-900/50 p-1 rounded">{JSON.stringify(insight.related_data)}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Visualizações Sugeridas */}
      {visualizations && visualizations.length > 0 && (
        <Section title="Visualizações Sugeridas" icon={<Chart type="bar" title="" data={[]} />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {visualizations.map((vis, index) => (
                    <div key={index} className="bg-gray-700/50 p-3 rounded-md text-sm">
                        <p className="font-semibold text-purple-300">{vis.title} ({vis.visualization_type})</p>
                        <p className="text-gray-300">{vis.description}</p>
                        <div className="text-xs text-gray-400 mt-2 font-mono">
                            <p>Eixo X: {vis.x_axis_column}</p>
                            <p>Eixo Y: {vis.y_axis_column}</p>
                        </div>
                    </div>
                ))}
            </div>
        </Section>
      )}

      {/* Prévia do Conteúdo */}
      {full_content_preview && (
        <Section title="Prévia do Conteúdo Extraído" icon={<DocumentTextIcon className="w-5 h-5" />}>
          <pre className="text-xs text-gray-400 bg-gray-900/70 p-3 rounded-md whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
            {full_content_preview}
          </pre>
        </Section>
      )}
    </div>
  );
};

export default DynamicAnalysisDisplay;
