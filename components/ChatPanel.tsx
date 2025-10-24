import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage, SmartSearchResult } from '../types';
import type { ExportType } from '../App';
import Chart from './Chart';
import { SendIcon, UserIcon, AiIcon, LoadingSpinnerIcon, StopIcon, DownloadIcon, DocumentTextIcon, PaperClipIcon } from './icons';
import { exportConversationToDocx, exportConversationToHtml, exportConversationToPdf } from '../utils/exportConversationUtils';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isStreaming: boolean;
  onStopStreaming: () => void;
  reportTitle: string;
  setError: (message: string | null) => void;
  onAddFiles: (files: File[]) => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ messages, onSendMessage, isStreaming, onStopStreaming, reportTitle, setError, onAddFiles }) => {
  const [input, setInput] = useState('');
  const [isExporting, setIsExporting] = useState<ExportType | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  // Close export menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        onAddFiles(Array.from(e.target.files));
        e.target.value = ''; // Reset input to allow re-selection
    }
  };
  
  const handleExport = async (type: ExportType) => {
    setIsExporting(type);
    setShowExportMenu(false);
    try {
        const filename = `Conversa_Analise_Fiscal_${reportTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
        const title = `Conversa sobre: ${reportTitle}`;

        switch(type) {
            case 'docx':
                await exportConversationToDocx(messages, title, filename);
                break;
            case 'html':
                await exportConversationToHtml(messages, title, filename);
                break;
            case 'pdf':
                await exportConversationToPdf(messages, title, filename);
                break;
        }

    } catch(err) {
        console.error(`Failed to export conversation as ${type}:`, err);
        setError(`Falha ao exportar a conversa como ${type.toUpperCase()}.`);
    } finally {
        setIsExporting(null);
    }
  };

  const exportOptions: { type: ExportType, label: string, icon: React.ReactNode }[] = [
      { type: 'docx', label: 'DOCX', icon: <DocumentTextIcon className="w-4 h-4" /> },
      { type: 'html', label: 'HTML', icon: <span className="font-bold text-sm">H</span> },
      { type: 'pdf', label: 'PDF', icon: <span className="font-bold text-sm">P</span> },
  ];
  
  const renderMessageContent = (message: ChatMessage) => {
    const html = message.text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\* (.*?)(?=\n\*|\n\n|$)/g, '<li class="ml-4 list-disc">$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

    return <div dangerouslySetInnerHTML={{ __html: html.replace(/\n/g, '<br />') }} />;
  };

  const suggestedQuestions = [
    "Qual foi o produto com o maior valor total?",
    "Resuma as principais inconsistências encontradas.",
    "Liste os 5 principais produtos por quantidade.",
    "Existe alguma oportunidade de otimização fiscal nos dados?",
  ];

  const handleSuggestionClick = (question: string) => {
      setInput(question);
      chatInputRef.current?.focus();
  };


  return (
    <div className="bg-gray-800 rounded-lg shadow-lg flex flex-col h-full max-h-[calc(100vh-12rem)] animate-fade-in">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-200">3. Chat Interativo</h2>
        <div className="relative" ref={exportMenuRef}>
            <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={!!isExporting}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                title="Exportar Conversa"
            >
                <DownloadIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Exportar Conversa</span>
            </button>
            {showExportMenu && (
                <div className="absolute top-full right-0 mt-2 w-40 bg-gray-700 rounded-md shadow-lg z-10 animate-fade-in-down-sm">
                    {exportOptions.map(({ type, label, icon }) => (
                         <button
                            key={type}
                            onClick={() => handleExport(type)}
                            disabled={!!isExporting}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-600 disabled:opacity-50"
                        >
                            {isExporting === type ? <LoadingSpinnerIcon className="w-4 h-4 animate-spin"/> : icon}
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
      </div>
      <div className="flex-grow p-4 overflow-y-auto space-y-6">
        {messages.map((message) => (
          <div key={message.id} className={`flex items-start gap-3 ${message.sender === 'user' ? 'justify-end' : ''}`}>
            {message.sender === 'ai' && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center flex-shrink-0">
                <AiIcon className="w-5 h-5 text-white" />
              </div>
            )}
            <div className={`max-w-xl p-3 rounded-lg ${
                message.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-gray-700 text-gray-200 rounded-bl-none'
              }`}>
              <div className="prose prose-sm prose-invert max-w-none">
                 {isStreaming && message.id === messages[messages.length - 1].id ? <LoadingSpinnerIcon className="w-5 h-5 animate-spin" /> : renderMessageContent(message)}
              </div>
              {message.chartData && (
                <div className="mt-4 bg-gray-800/50 p-4 rounded-md" data-chart-container="true">
                  <Chart {...message.chartData} />
                </div>
              )}
            </div>
             {message.sender === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
                <UserIcon className="w-5 h-5 text-gray-300" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t border-gray-700">
        {messages.length > 1 && !isStreaming && (
            <div className="mb-3 text-center animate-fade-in">
                <p className="text-xs text-gray-500 mb-2">Sugestões de Análise:</p>
                <div className="flex flex-wrap gap-2 justify-center">
                    {suggestedQuestions.map((q, i) => (
                        <button
                            key={i}
                            onClick={() => handleSuggestionClick(q)}
                            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded-full transition-colors"
                        >
                            {q}
                        </button>
                    ))}
                </div>
            </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            accept=".xml,.csv,.xlsx,.pdf,.png,.jpeg,.jpg,.zip"
            onChange={handleFileChange}
            disabled={isStreaming}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            className="p-2.5 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Adicionar mais arquivos à análise"
          >
            <PaperClipIcon className="w-5 h-5" />
          </button>
          <input
            ref={chatInputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isStreaming ? "Aguardando resposta..." : "Faça uma pergunta ou adicione arquivos..."}
            disabled={isStreaming}
            className="flex-grow bg-gray-700 rounded-full py-2 px-4 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow disabled:opacity-50"
          />
          {isStreaming ? (
            <button
                type="button"
                onClick={onStopStreaming}
                className="bg-red-600 hover:bg-red-500 text-white rounded-full p-2.5 transition-colors"
                title="Parar geração"
            >
                <StopIcon className="w-5 h-5" />
            </button>
          ) : (
            <button
                type="submit"
                disabled={!input.trim()}
                className="bg-blue-600 hover:bg-blue-500 text-white rounded-full p-2.5 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
                <SendIcon className="w-5 h-5" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

export default ChatPanel;