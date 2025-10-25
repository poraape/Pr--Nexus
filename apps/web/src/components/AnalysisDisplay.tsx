import React from 'react';
import type { DeterministicCrossValidationResult } from '../types';
import { ShieldExclamationIcon, FileIcon } from './icons';

interface AnalysisDisplayProps {
  results: DeterministicCrossValidationResult[] | undefined;
}

const severityStyles: Record<DeterministicCrossValidationResult['severity'], string> = {
    ALERTA: 'border-l-yellow-500',
    INFO: 'border-l-sky-500',
};

const AnalysisDisplay: React.FC<AnalysisDisplayProps> = ({ results }) => {
  if (!results || results.length === 0) {
    return (
      <div className="bg-gray-700/30 p-4 rounded-lg text-center">
        <p className="text-sm text-teal-400">✅ Nenhuma inconsistência material foi encontrada pela validação cruzada determinística.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-700/30 p-4 rounded-lg space-y-4">
        <div className="max-h-96 overflow-y-auto pr-2">
            {results.map((result, index) => (
                <div key={index} className={`bg-gray-800/50 p-4 rounded-lg border-l-4 mb-3 ${severityStyles[result.severity]}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="font-semibold text-gray-200">{result.attribute}: <span className="font-normal text-gray-400">"{result.comparisonKey}"</span></p>
                            <p className="text-sm text-yellow-300 mt-1">{result.description}</p>
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md`}>{result.severity}</span>
                    </div>
                    
                    <div className="mt-3">
                        <h4 className="text-xs font-semibold text-gray-500 mb-2">Evidências:</h4>
                        {result.discrepancies.map((d, i) => (
                             <div key={i} className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-gray-700/50 pt-2 mt-2">
                                <div className="flex items-center gap-2 truncate">
                                    <FileIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <span className="truncate text-gray-400" title={d.docA.name}>{d.docA.name}</span>
                                </div>
                                <p className="font-mono text-orange-300">{d.valueA}</p>
                                <div className="flex items-center gap-2 truncate">
                                    <FileIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    <span className="truncate text-gray-400" title={d.docB.name}>{d.docB.name}</span>
                                </div>
                                <p className="font-mono text-yellow-300">{d.valueB}</p>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
};

export default AnalysisDisplay;
