import React, { useMemo, useState, useEffect } from 'react';
import type { AuditReport, ChartData } from '../types';
import Chart from './Chart';
import CrossValidationPanel from './CrossValidationPanel';
import SmartSearch from './SmartSearch';
import { parseSafeFloat } from '../utils/parsingUtils';
import AnalysisDisplay from './AnalysisDisplay';

interface DashboardProps {
    report: AuditReport;
}

// Tabela de alíquotas de ICMS interestadual.
// Chave: 'ORIGEM-DESTINO'. O sistema usa fallbacks para casos não listados.
const ICMS_RATE_TABLE: Record<string, number> = {
    'SP-RJ': 12, 'SP-MG': 12, 'SP-ES': 12, 'SP-PR': 12, 'SP-SC': 12, 'SP-RS': 12,
    'RJ-SP': 12, 'RJ-MG': 12, 'RJ-ES': 12,
    'MG-SP': 12, 'MG-RJ': 12, 'MG-ES': 12,
    'BA-SP': 7, 'BA-RJ': 7, 'PE-SP': 7,
    'DEFAULT_INTERSTATE_SE_CO': 12, // Alíquota do S/SE/CO para N/NE/ES
    'DEFAULT_INTERSTATE_N_NE': 7, // Alíquota do N/NE/ES para S/SE/CO
    'DEFAULT_INTRASTATE': 18,
};

const UF_REGIONS: Record<string, 'S' | 'SE' | 'CO' | 'N' | 'NE'> = {
    SP: 'SE', RJ: 'SE', MG: 'SE', ES: 'SE',
    PR: 'S', SC: 'S', RS: 'S',
    MS: 'CO', MT: 'CO', GO: 'CO', DF: 'CO',
    AC: 'N', AP: 'N', AM: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
    AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
};

const getIcmsRate = (originUf: string, destUf: string): number => {
    if (originUf === destUf) return ICMS_RATE_TABLE.DEFAULT_INTRASTATE;
    const key = `${originUf}-${destUf}`;
    if (ICMS_RATE_TABLE[key]) return ICMS_RATE_TABLE[key];

    const originRegion = UF_REGIONS[originUf];
    const destRegion = UF_REGIONS[destUf];

    if (originRegion && destRegion) {
        if ((originRegion === 'S' || originRegion === 'SE' || originRegion === 'CO') && (destRegion === 'N' || destRegion === 'NE')) {
            return ICMS_RATE_TABLE.DEFAULT_INTERSTATE_SE_CO;
        }
        if ((originRegion === 'N' || originRegion === 'NE') && (destRegion === 'S' || destRegion === 'SE' || destRegion === 'CO')) {
            return ICMS_RATE_TABLE.DEFAULT_INTERSTATE_N_NE;
        }
    }
    // Default for S-S, SE-SE, etc.
    return ICMS_RATE_TABLE.DEFAULT_INTERSTATE_SE_CO;
}


interface MemoizedChartData {
    cfopChart: ChartData;
    ncmChart: ChartData;
    ufChart: ChartData;
}

const Dashboard: React.FC<DashboardProps> = ({ report }) => {
    const [simulationRate, setSimulationRate] = useState<number>(18.0);
    const [baseValueForSim, setBaseValueForSim] = useState<number>(0);
    const [referenceRate, setReferenceRate] = useState<number>(18.0);

    useEffect(() => {
        const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data && d.doc.data.length > 0);
        const allItems = validDocs.flatMap(d => d.doc.data!);
        
        let totalProductValue = 0;
        let weightedIcmsSum = 0;

        for (const item of allItems) {
            const value = parseSafeFloat(item.produto_valor_total);
            totalProductValue += value;

            const originUf = item.emitente_uf || 'SP';
            const destUf = item.destinatario_uf || 'SP';
            const rate = getIcmsRate(originUf, destUf);
            weightedIcmsSum += value * (rate / 100);
        }

        const avgRate = totalProductValue > 0 ? (weightedIcmsSum / totalProductValue) * 100 : 18.0;

        setBaseValueForSim(totalProductValue);
        setReferenceRate(avgRate);
        setSimulationRate(avgRate); // Initialize slider with the reference rate

    }, [report]);

    const estimatedIcms = baseValueForSim * (simulationRate / 100);

    const chartData = useMemo((): MemoizedChartData => {
        const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data && d.doc.data.length > 0);
        const allItems = validDocs.flatMap(d => d.doc.data!);
        
        const cfopData: Record<string, number> = {};
        const ncmData: Record<string, number> = {};

        for (const item of allItems) {
            const value = parseSafeFloat(item.produto_valor_total);
            
            const cfop = item.produto_cfop?.toString() || 'N/A';
            cfopData[cfop] = (cfopData[cfop] || 0) + value;

            const ncm = item.produto_ncm?.toString() || 'N/A';
            ncmData[ncm] = (ncmData[ncm] || 0) + value;
        }

        // FIX: Replaced reduce with forEach to ensure correct type inference for ufDestData.
        const ufDestData: Record<string, number> = {};
        validDocs.forEach((auditedDoc) => {
            if (auditedDoc.doc.data && auditedDoc.doc.data.length > 0) {
                const uf = auditedDoc.doc.data[0].destinatario_uf || 'N/A';
                ufDestData[uf] = (ufDestData[uf] || 0) + 1;
            }
        });


        return {
            cfopChart: {
                type: 'bar',
                title: 'Valor por CFOP (Top 10)',
                data: Object.entries(cfopData).sort((a,b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value })),
                yAxisLabel: 'Valor (R$)',
            },
            ncmChart: {
                type: 'pie',
                title: 'Distribuição por NCM (Top 5)',
                data: Object.entries(ncmData).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value })),
            },
            ufChart: {
                type: 'bar',
                title: 'Documentos por UF de Destino',
                data: Object.entries(ufDestData).map(([label, value]) => ({ label, value })),
                yAxisLabel: 'Qtd. Documentos',
            },
        };
    }, [report]);

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg animate-fade-in space-y-8">
            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4">Dashboard Interativo</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                   <div className="bg-gray-700/50 p-4 rounded-md" data-chart-container="true">
                        <Chart {...chartData.cfopChart} />
                   </div>
                   <div className="bg-gray-700/50 p-4 rounded-md" data-chart-container="true">
                        <Chart {...chartData.ncmChart} />
                   </div>
                   <div className="bg-gray-700/50 p-4 rounded-md" data-chart-container="true">
                        <Chart {...chartData.ufChart} />
                   </div>
                </div>
            </div>

            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Simulação Tributária (What-If ICMS)</h2>
                <div className="bg-gray-700/30 p-4 rounded-lg space-y-4">
                    <p className="text-xs text-gray-400 text-center">
                        Ajuste a alíquota para simular o impacto do ICMS sobre a base de cálculo total dos produtos de{' '}
                        <span className="font-bold text-teal-300">{baseValueForSim.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>.
                        A alíquota de referência calculada a partir dos dados é <span className="font-bold text-blue-300">{referenceRate.toFixed(2)}%</span>.
                    </p>
                    <div className="flex items-center gap-3">
                        <input
                            id="icms-rate"
                            type="range"
                            min="0"
                            max="40"
                            step="0.1"
                            value={simulationRate}
                            onChange={(e) => setSimulationRate(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="font-mono text-lg text-teal-300 w-24 text-center bg-gray-900/50 py-1 rounded-md">{simulationRate.toFixed(2)}%</span>
                    </div>
                     <div className="text-center bg-gray-900/50 p-3 rounded-lg">
                        <p className="text-sm text-gray-400">ICMS Estimado</p>
                        <p className="text-2xl font-bold text-teal-300 font-mono">
                            {estimatedIcms.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                    </div>
                </div>
            </div>
            
            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Busca Inteligente com IA</h2>
                 <SmartSearch report={report} />
            </div>

            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Validação Cruzada Determinística</h2>
                <p className="text-xs text-gray-500 mb-4">
                    Comparações baseadas em regras para encontrar discrepâncias objetivas entre os documentos, como variações de preço ou NCMs inconsistentes para o mesmo produto.
                </p>
                <AnalysisDisplay results={report.deterministicCrossValidation} />
            </div>

            <div>
                <h2 className="text-xl font-bold text-gray-200 mb-4 border-t border-gray-700 pt-8">Validação Cruzada por IA</h2>
                <p className="text-xs text-gray-500 mb-4">
                    A IA compara atributos fiscais e valores entre todos os itens para encontrar inconsistências sutis ou padrões que merecem atenção.
                </p>
                <CrossValidationPanel results={report.crossValidationResults} />
            </div>
        </div>
    );
};

export default Dashboard;