import type { AuditReport, AuditedDocument, ClassificationResult } from '../types';

// Simplified mapping of NCM prefixes to business sectors
const NCM_SECTOR_MAP: Record<string, string> = {
    '84': 'Máquinas e Equipamentos',
    '85': 'Material Elétrico',
    '8471': 'Tecnologia da Informação',
    '22': 'Bebidas',
    '10': 'Produtos de Moagem',
    '2106': 'Preparações Alimentícias Diversas',
    // ... add more mappings as needed
};

const getBusinessSector = (ncm: string): string => {
    if (!ncm || ncm.length < 2) return 'Não Classificado';
    const ncm4 = ncm.substring(0, 4);
    const ncm2 = ncm.substring(0, 2);

    return NCM_SECTOR_MAP[ncm4] || NCM_SECTOR_MAP[ncm2] || 'Comércio Varejista/Atacadista';
};

type ClassificationCorrections = Record<string, ClassificationResult['operationType']>;


/**
 * Heuristically classifies the type of operation for each document in an audit report
 * based on the CFOP codes of its items. It prioritizes user-provided corrections.
 * @param report The initial audit report.
 * @param corrections A map of document names to user-corrected classifications.
 * @returns A promise that resolves with the enriched AuditReport including classifications.
 */
export const runClassification = async (
    report: Omit<AuditReport, 'summary'>,
    corrections: ClassificationCorrections
): Promise<Omit<AuditReport, 'summary'>> => {
  console.log(`Classifier Agent: Classifying ${report.documents.length} documents.`);

  const classifiedDocuments = report.documents.map((auditedDoc): AuditedDocument => {
    if (auditedDoc.status === 'ERRO' || !auditedDoc.doc.data) {
      return auditedDoc; // Skip classification for documents with errors or no data
    }

    // --- Incremental Learning: Check for a user correction first ---
    const userCorrection = corrections[auditedDoc.doc.name];
    if (userCorrection && auditedDoc.classification) {
        return {
            ...auditedDoc,
            classification: {
                ...auditedDoc.classification,
                operationType: userCorrection,
                confidence: 1.0, // User correction has 100% confidence
            },
        };
    }


    const cfopCounts: Record<string, number> = {
      compra: 0,
      venda: 0,
      devolucao: 0,
      servico: 0,
      transferencia: 0,
      outros: 0,
    };
    
    let totalItems = 0;
    const sectorScores: Record<string, number> = {};

    for (const item of auditedDoc.doc.data) {
      const cfop = item.produto_cfop?.toString();
      const ncm = item.produto_ncm?.toString();
      
      if (cfop) {
         totalItems++;

        if (cfop.startsWith('1') || cfop.startsWith('2')) {
            if (cfop.startsWith('12') || cfop.startsWith('22')) cfopCounts.devolucao++;
            else if (cfop.startsWith('14') || cfop.startsWith('24')) cfopCounts.compra++; // ST
            else if (cfop.startsWith('13') || cfop.startsWith('23')) cfopCounts.servico++;
            else if (cfop.startsWith('155') || cfop.startsWith('255')) cfopCounts.transferencia++;
            else cfopCounts.compra++;
        } else if (cfop.startsWith('5') || cfop.startsWith('6')) {
            if (cfop.startsWith('52') || cfop.startsWith('62')) cfopCounts.devolucao++;
            else if (cfop.startsWith('5933') || cfop.startsWith('6933')) cfopCounts.servico++;
            else if (cfop.startsWith('555') || cfop.startsWith('655')) cfopCounts.transferencia++;
            else cfopCounts.venda++;
        } else {
            cfopCounts.outros++;
        }
      }
      
      if (ncm) {
          const sector = getBusinessSector(ncm);
          sectorScores[sector] = (sectorScores[sector] || 0) + 1;
      }
    }
    
    if (totalItems === 0) {
        return auditedDoc;
    }

    // Determine the primary operation type
    const primaryType = Object.entries(cfopCounts).reduce((a, b) => a[1] > b[1] ? a : b);
    const primarySector = Object.keys(sectorScores).length > 0
        ? Object.entries(sectorScores).reduce((a, b) => a[1] > b[1] ? a : b)[0]
        : 'Não Classificado';
    
    const operationTypeMap: Record<string, ClassificationResult['operationType']> = {
        compra: 'Compra',
        venda: 'Venda',
        devolucao: 'Devolução',
        servico: 'Serviço',
        transferencia: 'Transferência',
        outros: 'Outros'
    };

    const classification: ClassificationResult = {
      operationType: operationTypeMap[primaryType[0]],
      businessSector: primarySector,
      confidence: primaryType[1] / totalItems,
    };

    return { ...auditedDoc, classification };
  });

  // Simulate computation time
  await new Promise(resolve => setTimeout(resolve, 300));

  return {
    ...report,
    documents: classifiedDocuments,
  };
};
