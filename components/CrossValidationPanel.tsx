import React from 'react';
import type { CrossValidationResult } from '../types';
import { AiIcon } from './icons';

interface CrossValidationPanelProps {
  results: CrossValidationResult[] | undefined;
}

const CrossValidationPanel: React.FC<CrossValidationPanelProps> = ({ results }) => {
  if (!results || results.length === 0) {
    return (
      <div className="bg-gray-700/30 p-4 rounded-lg text-center">
        <p className="text-sm text-teal-400">✅ Nenhuma discrepância fiscal material foi encontrada pela IA entre os documentos analisados.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-700/30 p-4 rounded-lg">
        <div className="max-h-96 overflow-y-auto pr-2">
            <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-400 uppercase bg-gray-700/50 sticky top-0">
                    <tr>
                        <th scope="col" className="px-4 py-2">Atributo</th>
                        <th scope="col" className="px-4 py-2">Documento A</th>
                        <th scope="col" className="px-4 py-2">Valor A</th>
                        <th scope="col" className="px-4 py-2">Documento B</th>
                        <th scope="col" className="px-4 py-2">Valor B</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                    {results.map((result, index) => {
                        const docA = result.documents[0];
                        const docB = result.documents[1];
                        return (
                            <React.Fragment key={index}>
                                <tr className="hover:bg-gray-600/20">
                                    <td className="px-4 py-3 font-semibold text-gray-300">{result.attribute}</td>
                                    <td className="px-4 py-3 text-gray-400 truncate max-w-[150px]" title={docA.name}>{docA.name}</td>
                                    <td className="px-4 py-3 font-mono text-orange-300">{docA.value}</td>
                                    <td className="px-4 py-3 text-gray-400 truncate max-w-[150px]" title={docB.name}>{docB.name}</td>
                                    <td className="px-4 py-3 font-mono text-yellow-300">{docB.value}</td>
                                </tr>
                                <tr className="bg-gray-900/20">
                                    <td colSpan={5} className="px-4 py-2 text-xs">
                                        <div className="flex items-start gap-2">
                                            <AiIcon className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                                            <p className="text-gray-400">
                                                <span className="font-semibold text-sky-400">Observação da IA:</span> {result.observation}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            </React.Fragment>
                        )
                    })}
                </tbody>
            </table>
        </div>
    </div>
  );
};

export default CrossValidationPanel;
