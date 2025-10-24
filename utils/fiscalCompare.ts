import type { AuditReport, DeterministicCrossValidationResult } from '../types';
import { parseSafeFloat } from './parsingUtils';

const PRICE_VARIATION_THRESHOLD = 0.15; // 15% variation to trigger an alert

type ItemWithSource = Record<string, any> & {
    docSource: {
        name: string;
        internal_path?: string;
    }
};

/**
 * Runs deterministic cross-validation checks across all documents in a report.
 * @param report The audit report containing documents to be compared.
 * @returns An array of findings from the cross-validation.
 */
export const runDeterministicCrossValidation = async (
    report: Omit<AuditReport, 'summary'>
): Promise<DeterministicCrossValidationResult[]> => {
    const findings: DeterministicCrossValidationResult[] = [];
    const validDocs = report.documents.filter(d => d.status !== 'ERRO' && d.doc.data && d.doc.data.length > 0);
    
    if (validDocs.length < 1) {
        return [];
    }
    
    // 1. Group all items by product name
    const itemsByProduct = new Map<string, ItemWithSource[]>();
    for (const doc of validDocs) {
        for (const item of doc.doc.data!) {
            const productName = item.produto_nome?.toString().trim();
            if (productName) {
                const itemWithSource: ItemWithSource = {
                    ...item,
                    docSource: {
                        name: doc.doc.name,
                        internal_path: doc.doc.meta?.internal_path,
                    }
                };
                if (!itemsByProduct.has(productName)) {
                    itemsByProduct.set(productName, []);
                }
                itemsByProduct.get(productName)!.push(itemWithSource);
            }
        }
    }

    // 2. Analyze each product group for discrepancies
    for (const [productName, items] of itemsByProduct.entries()) {
        if (items.length < 2) continue;

        // Check for NCM mismatches
        const ncmValues = new Map<string, ItemWithSource[]>();
        items.forEach(item => {
            const ncm = item.produto_ncm?.toString() || 'N/A';
            if (!ncmValues.has(ncm)) ncmValues.set(ncm, []);
            ncmValues.get(ncm)!.push(item);
        });

        if (ncmValues.size > 1) {
            const [firstNcm, ...otherNcms] = Array.from(ncmValues.keys());
            findings.push({
                comparisonKey: productName,
                attribute: 'NCM',
                description: `O produto "${productName}" foi encontrado com múltiplos códigos NCM (${Array.from(ncmValues.keys()).join(', ')}), o que pode levar a tributação inconsistente.`,
                discrepancies: otherNcms.map(otherNcm => ({
                    valueA: firstNcm,
                    docA: ncmValues.get(firstNcm)![0].docSource,
                    valueB: otherNcm,
                    docB: ncmValues.get(otherNcm)![0].docSource,
                })),
                severity: 'ALERTA',
            });
        }
        
        // Check for significant price variations
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        let minPriceItem: ItemWithSource | null = null;
        let maxPriceItem: ItemWithSource | null = null;

        items.forEach(item => {
            const unitPrice = parseSafeFloat(item.produto_valor_unit);
            if (unitPrice > 0) {
                if (unitPrice < minPrice) {
                    minPrice = unitPrice;
                    minPriceItem = item;
                }
                if (unitPrice > maxPrice) {
                    maxPrice = unitPrice;
                    maxPriceItem = item;
                }
            }
        });

        if (minPriceItem && maxPriceItem && minPrice !== maxPrice) {
            const variation = (maxPrice - minPrice) / minPrice;
            if (variation > PRICE_VARIATION_THRESHOLD) {
                findings.push({
                    comparisonKey: productName,
                    attribute: 'Preço Unitário',
                    description: `Variação de preço de ${ (variation * 100).toFixed(0) }% detectada para o produto "${productName}".`,
                    discrepancies: [{
                        valueA: minPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                        docA: minPriceItem.docSource,
                        valueB: maxPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                        docB: maxPriceItem.docSource,
                    }],
                    severity: 'ALERTA',
                });
            }
        }
    }
    
    // Simulate async work
    await new Promise(resolve => setTimeout(resolve, 300));

    return findings;
};