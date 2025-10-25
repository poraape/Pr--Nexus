import React from 'react';
import { ErrorIcon } from './icons';

interface PipelineErrorDisplayProps {
  onReset: () => void;
  errorMessage: string | null;
}

const PipelineErrorDisplay: React.FC<PipelineErrorDisplayProps> = ({ onReset, errorMessage }) => {
  return (
    <div className="bg-gray-800 p-8 rounded-lg shadow-lg text-center animate-fade-in max-w-lg mx-auto mt-10">
      <ErrorIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
      <h2 className="text-2xl font-bold text-red-400 mb-2">Falha na Análise</h2>
      <p className="text-gray-400 mb-6">
        {errorMessage || 'Ocorreu um erro inesperado durante o processamento dos seus arquivos.'}
      </p>
      <button
        onClick={onReset}
        className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-lg transition-colors"
      >
        Tentar Novamente
      </button>
    </div>
  );
};

export default PipelineErrorDisplay;
