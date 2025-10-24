import type { ImportedDoc, AuditReport, AuditedDocument, AuditStatus, Inconsistency } from '../types';
import { runFiscalValidation } from '../utils/rulesEngine';

const SEVERITY_WEIGHTS: Record<Inconsistency['severity'], number> = {
    'ERRO': 10,
    'ALERTA': 2,
    'INFO': 0,
};

/**
 * Runs a deterministic fiscal audit on a list of imported documents.
 * It uses a rules engine to find real inconsistencies.
 * @param docs The array of ImportedDoc from the import pipeline.
 * @returns A promise that resolves with an AuditReport object.
 */
export const runAudit = async (docs: ImportedDoc[]): Promise<Omit<AuditReport, 'summary'>> => {
  console.log(`Auditor Agent: Auditing ${docs.length} documents.`);

  const auditedDocuments: AuditedDocument[] = docs.map(doc => {
    // If the document already has an error from the import pipeline
    if (doc.status === 'error' || doc.status === 'unsupported') {
      return {
        doc,
        status: 'ERRO',
        score: 99, // High score for import failures
        inconsistencies: [{
          code: 'IMPORT-FAIL',
          message: doc.error || 'Falha na importação ou formato não suportado.',
          explanation: `O arquivo "${doc.name}" não pôde ser lido corretamente. Verifique se o arquivo não está corrompido e se o formato é um dos suportados.`,
          severity: 'ERRO',
        }],
      };
    }

    let allInconsistencies: Inconsistency[] = [];
    if(doc.data){
        for(const item of doc.data){
            const findings = runFiscalValidation(item);
            allInconsistencies.push(...findings);
        }
    }

    // Deduplicate inconsistencies based on code
    const uniqueInconsistencies = Array.from(new Map(allInconsistencies.map(item => [item.code, item])).values());
    
    let status: AuditStatus = 'OK';
    if (uniqueInconsistencies.length > 0) {
        if (uniqueInconsistencies.some(inc => inc.severity === 'ERRO')) {
            status = 'ERRO';
        } else if (uniqueInconsistencies.some(inc => inc.severity === 'ALERTA')) {
            status = 'ALERTA';
        }
    }

    const score = uniqueInconsistencies.reduce((acc, inc) => {
        return acc + (SEVERITY_WEIGHTS[inc.severity] || 0);
    }, 0);

    return {
      doc,
      status,
      score,
      inconsistencies: uniqueInconsistencies,
    };
  });

  // Simulate computation time
  await new Promise(resolve => setTimeout(resolve, 500 + docs.length * 10));

  return {
    documents: auditedDocuments,
  };
};