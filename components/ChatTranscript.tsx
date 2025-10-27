import React from 'react';
import type { ChatMessage } from '../types';
import { AiIcon, UserIcon } from './icons';
import Chart from './Chart';

interface ChatTranscriptProps {
    messages: ChatMessage[];
}

const formatTimestamp = (isoString?: string) => {
    if (!isoString) return null;
    try {
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) {
            return null;
        }
        return date.toLocaleString('pt-BR');
    } catch (error) {
        console.warn('[ChatTranscript] Failed to format timestamp', error);
        return null;
    }
};

const ChatTranscript: React.FC<ChatTranscriptProps> = ({ messages }) => {
    if (!messages.length) {
        return (
            <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-bold text-gray-200 mb-4" data-export-title>
                    Histórico Completo do Chat
                </h2>
                <p className="text-sm text-gray-400">
                    Nenhuma interação registrada até o momento.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg space-y-6">
            <h2 className="text-xl font-bold text-gray-200" data-export-title>
                Histórico Completo do Chat
            </h2>
            <div className="space-y-6">
                {messages.map(message => {
                    const timestamp = formatTimestamp(message.timestamp);
                    const isUser = message.sender === 'user';

                    return (
                        <article
                            key={message.id}
                            className={`flex gap-3 ${isUser ? 'flex-row-reverse text-right' : ''}`}
                        >
                            <div
                                className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                                    isUser
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gradient-to-br from-blue-500 to-teal-400 text-white'
                                }`}
                                aria-hidden="true"
                            >
                                {isUser ? <UserIcon className="w-5 h-5" /> : <AiIcon className="w-5 h-5" />}
                            </div>
                            <div className="flex-1 space-y-3">
                                <header className="flex items-center text-xs text-gray-400 gap-2">
                                    <span className="font-semibold text-gray-300">
                                        {isUser ? 'Usuário' : 'Nexus QuantumI2A2'}
                                    </span>
                                    {timestamp && <span>{timestamp}</span>}
                                </header>
                                <div
                                    className={`rounded-lg p-4 text-sm leading-relaxed ${
                                        isUser
                                            ? 'bg-blue-600/90 text-white'
                                            : 'bg-gray-700 text-gray-200 shadow-inner'
                                    }`}
                                >
                                    <div
                                        className="prose prose-sm prose-invert max-w-none space-y-2"
                                        dangerouslySetInnerHTML={{
                                            __html: message.text
                                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                                .replace(/\* (.*?)(?=\n\*|\n\n|$)/g, '<li class="ml-4 list-disc">$1</li>')
                                                .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
                                                .replace(/\n/g, '<br />'),
                                        }}
                                    />
                                    {message.attachments && message.attachments.length > 0 && (
                                        <ul className="mt-3 text-xs text-gray-300" data-export-title>
                                            {message.attachments.map(attachment => (
                                                <li key={attachment.name}>{attachment.name}</li>
                                            ))}
                                        </ul>
                                    )}
                                    {message.chartData && (
                                        <div
                                            className="mt-4 bg-gray-800/60 p-4 rounded-md"
                                            data-chart-container="true"
                                        >
                                            <Chart {...message.chartData} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
};

export default ChatTranscript;
