import React from 'react';
import type { AgentStates } from '../hooks/useAgentOrchestrator';
import { CheckIcon, LoadingSpinnerIcon, ErrorIcon } from './icons';

const ProgressTracker: React.FC<{ agentStates: AgentStates }> = ({ agentStates }) => {
    const steps = [
        { id: 'ocr', label: '1. Ag. OCR' },
        { id: 'auditor', label: '2. Ag. Auditor' },
        { id: 'classifier', label: '3. Ag. Classificador' },
        { id: 'crossValidator', label: '4. Ag. Validador' },
        { id: 'intelligence', label: '5. Ag. Inteligência' },
        { id: 'accountant', label: '6. Ag. Contador' },
    ];

    const runningAgent = (Object.keys(agentStates) as (keyof AgentStates)[]).find(key => agentStates[key].status === 'running');
    const progressDetails = runningAgent ? agentStates[runningAgent].progress : null;

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg animate-fade-in">
            <h2 className="text-xl font-bold mb-4 text-gray-200">Progresso da Análise</h2>
            <div className="flex items-center justify-between mb-4">
                {steps.map((step, index) => {
                    const agentName = step.id as keyof AgentStates;
                    const { status } = agentStates[agentName];
                    const isCompleted = status === 'completed';
                    const isCurrent = status === 'running';

                    return (
                        <React.Fragment key={step.id}>
                            <div className="flex items-center gap-2 flex-col sm:flex-row text-center">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0
                                    ${status === 'completed' ? 'bg-teal-500' : status === 'running' ? 'bg-blue-500' : status === 'error' ? 'bg-red-600' : 'bg-gray-700'}`}>
                                    {status === 'completed' ? <CheckIcon className="w-5 h-5 text-white" /> : status === 'running' ? <LoadingSpinnerIcon className="w-5 h-5 text-white animate-spin" /> : status === 'error' ? <span className="font-bold text-lg text-white">!</span> : <span className="text-gray-400 font-bold">{index + 1}</span>}
                                </div>
                                <span className={`font-semibold text-xs sm:text-base ${isCompleted || isCurrent ? 'text-gray-200' : 'text-gray-500'}`}>{step.label}</span>
                            </div>
                            {index < steps.length - 1 && <div className={`flex-1 h-1 mx-2 sm:mx-4 rounded ${isCompleted ? 'bg-teal-500' : 'bg-gray-700'}`}></div>}
                        </React.Fragment>
                    );
                })}
            </div>
             {progressDetails && (
                 <div className="text-center text-sm text-gray-400 h-8 flex items-center justify-center">
                    <p>{progressDetails.step} {progressDetails.total > 0 && `(${progressDetails.current} / ${progressDetails.total})`}</p>
                 </div>
            )}
        </div>
    );
};

export default ProgressTracker;