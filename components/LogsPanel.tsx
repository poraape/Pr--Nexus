import React, { useState, useEffect } from 'react';
import { logger, type LogEntry, type LogLevel } from '../services/logger';

interface LogsPanelProps {
  onClose: () => void;
}

const levelStyles: Record<LogLevel, string> = {
    INFO: 'bg-blue-500/20 text-blue-300',
    WARN: 'bg-yellow-500/20 text-yellow-300',
    ERROR: 'bg-red-500/20 text-red-300',
};

const LogsPanel: React.FC<LogsPanelProps> = ({ onClose }) => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [filterLevel, setFilterLevel] = useState<LogLevel | 'ALL'>('ALL');

    useEffect(() => {
        const handleNewLogs = (newLogs: LogEntry[]) => {
            setLogs([...newLogs]);
        };
        logger.subscribe(handleNewLogs);
        return () => logger.unsubscribe(handleNewLogs);
    }, []);

    const filteredLogs = logs.filter(log => filterLevel === 'ALL' || log.level === filterLevel);

    const exportLogs = (format: 'json' | 'txt') => {
        let content = '';
        const filename = `nexus-logs-${new Date().toISOString()}`;
        if (format === 'json') {
            content = JSON.stringify(logs, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            saveAs(blob, `${filename}.json`);
        } else {
            content = logs.map(l => `${l.timestamp} [${l.level}] (${l.agent}): ${l.message} ${l.metadata ? JSON.stringify(l.metadata) : ''}`).join('\n');
            const blob = new Blob([content], { type: 'text/plain' });
            saveAs(blob, `${filename}.txt`);
        }
    };
    
     const saveAs = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm z-40 flex items-center justify-center animate-fade-in" onClick={onClose}>
            <div className="bg-gray-800 w-full max-w-4xl h-[80vh] rounded-lg shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold">Logs de Execução</h2>
                    <div className="flex items-center gap-4">
                        <select
                            value={filterLevel}
                            onChange={(e) => setFilterLevel(e.target.value as any)}
                            className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="ALL">Todos os Níveis</option>
                            <option value="INFO">INFO</option>
                            <option value="WARN">WARN</option>
                            <option value="ERROR">ERROR</option>
                        </select>
                         <div className="flex items-center gap-2">
                            <button onClick={() => exportLogs('json')} className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded-md">Exportar JSON</button>
                            <button onClick={() => exportLogs('txt')} className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded-md">Exportar TXT</button>
                        </div>
                        <button onClick={onClose} className="text-2xl text-gray-500 hover:text-white">&times;</button>
                    </div>
                </div>
                <div className="flex-grow p-4 overflow-y-auto font-mono text-xs">
                    {filteredLogs.map((log, i) => (
                        <div key={i} className="flex items-start gap-3 mb-2">
                            <span className="text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                            <span className={`px-1.5 py-0.5 rounded-md text-xs font-semibold ${levelStyles[log.level]}`}>{log.level}</span>
                            <span className="text-purple-400">[{log.agent}]</span>
                            <p className="text-gray-300 flex-1 whitespace-pre-wrap">{log.message}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default LogsPanel;
