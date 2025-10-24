import React from 'react';
import { DownloadIcon, LoadingSpinnerIcon, DocumentTextIcon, FileInfoIcon, PanelLayoutIcon } from './icons';
import type { ExportType } from '../App';
import LogoIcon from './LogoIcon'; // Importa o novo ícone

interface HeaderProps {
    onReset: () => void;
    showExports: boolean;
    showSpedExport: boolean;
    isExporting: ExportType | null;
    onExport: (type: ExportType) => void;
    onToggleLogs: () => void;
    isPanelCollapsed?: boolean;
    onTogglePanel?: () => void;
}

const Header: React.FC<HeaderProps> = ({ onReset, showExports, showSpedExport, isExporting, onExport, onToggleLogs, isPanelCollapsed, onTogglePanel }) => {
  const exportOptions: { type: ExportType, label: string, icon: React.ReactNode }[] = [
      { type: 'pdf', label: 'PDF', icon: <span className="font-bold text-sm">P</span> },
      { type: 'docx', label: 'DOCX', icon: <DocumentTextIcon className="w-4 h-4" /> },
      { type: 'html', label: 'HTML', icon: <span className="font-bold text-sm">H</span> },
      { type: 'xlsx', label: 'XLSX', icon: <span className="font-bold text-sm">X</span> },
      { type: 'json', label: 'JSON', icon: <span className="font-bold text-sm">J</span> },
      { type: 'md', label: 'MD', icon: <span className="font-bold text-sm">M</span> },
  ];

  return (
    <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-700/50 sticky top-0 z-10">
      <div className="container mx-auto px-4 md:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
            <div 
                className="flex items-center gap-3 cursor-pointer group"
                onClick={onReset}
                title="Iniciar Nova Análise"
            >
                <LogoIcon className="w-9 h-9" />
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300 group-hover:from-blue-300 group-hover:to-teal-200 transition-colors">
                        Nexus QuantumI2A2
                    </h1>
                    <p className="text-xs md:text-sm text-gray-400 -mt-1">
                        Interactive Insight & Intelligence from Fiscal Analysis
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                 {showExports && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onTogglePanel}
                            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors w-9 h-9 flex items-center justify-center"
                            title={isPanelCollapsed ? "Mostrar Painel de Análise" : "Ocultar Painel de Análise"}
                        >
                            <PanelLayoutIcon className="w-5 h-5"/>
                        </button>
                        <span className="text-sm text-gray-400 hidden sm:block">Exportar Relatório:</span>
                        {exportOptions.map(({ type, label, icon }) => (
                            <button
                                key={type}
                                onClick={() => onExport(type)}
                                disabled={!!isExporting}
                                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait w-9 h-9 flex items-center justify-center"
                                title={`Exportar para ${label}`}
                            >
                                {isExporting === type ? <LoadingSpinnerIcon className="w-4 h-4 animate-spin"/> : icon}
                            </button>
                        ))}
                    </div>
                )}
                
                {showSpedExport && (
                    <button
                        onClick={() => onExport('sped')}
                        disabled={!!isExporting}
                        className="px-3 py-2 bg-teal-600 hover:bg-teal-500 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait h-9 flex items-center justify-center gap-2 text-sm"
                        title="Exportar SPED/EFD"
                    >
                        {isExporting === 'sped' ? <LoadingSpinnerIcon className="w-4 h-4 animate-spin"/> : <DownloadIcon className="w-4 h-4"/>}
                        <span className="hidden sm:inline">SPED</span>
                    </button>
                )}


                 <button
                    onClick={onToggleLogs}
                    className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors w-9 h-9 flex items-center justify-center"
                    title="Ver Logs de Execução"
                >
                    <FileInfoIcon className="w-5 h-5"/>
                </button>
            </div>
        </div>
      </div>
    </header>
  );
};

export default Header;