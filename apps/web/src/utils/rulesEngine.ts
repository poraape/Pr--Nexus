import { INCONSISTENCIES } from './rulesDictionary';
import type { Inconsistency } from '../types';
import { parseSafeFloat } from './parsingUtils';

export const runFiscalValidation = (item: Record<string, any>): Inconsistency[] => {
  const findings: Inconsistency[] = [];
  const cfop = item.produto_cfop?.toString() || '';
  const ncm = item.produto_ncm?.toString() || '';
  const cstIcms = item.produto_cst_icms?.toString();
  const cstPis = item.produto_cst_pis?.toString();
  const cstCofins = item.produto_cst_cofins?.toString();
  const qCom = parseSafeFloat(item.produto_qtd);
  const vUnCom = parseSafeFloat(item.produto_valor_unit);
  const vProd = parseSafeFloat(item.produto_valor_total);

  // Rule 1: Validate CFOP for sales vs. purchases.
  // This is a simplified check. A real system would cross-reference against more company data.
  if (cfop.startsWith('5') || cfop.startsWith('6')) {
    // CFOP indicates a sale. If the recipient name matches a known company name for internal transfers/purchases, flag it.
    if (item.destinatario_nome?.toLowerCase().includes('quantum innovations')) {
        findings.push(INCONSISTENCIES.CFOP_SAIDA_EM_COMPRA);
    }
  }

  // Rule 2: NCM validation
  if (ncm === '00000000' && !item.produto_nome?.toLowerCase().includes('serviço') && !item.produto_nome?.toLowerCase().includes('consultoria')) {
    findings.push(INCONSISTENCIES.NCM_SERVICO_PARA_PRODUTO);
  }
  if (ncm && ncm !== '00000000' && ncm.length !== 8) {
      findings.push(INCONSISTENCIES.NCM_INVALIDO);
  }

  // Rule 3: Value calculation check
  if (qCom > 0 && vUnCom > 0 && vProd > 0) {
      const calculatedTotal = qCom * vUnCom;
      const difference = Math.abs(calculatedTotal - vProd);
      // Allow for a small rounding difference (e.g., 0.1% of value or 1 cent)
      if (difference > (calculatedTotal * 0.001) && difference > 0.01) {
          findings.push(INCONSISTENCIES.VALOR_CALCULO_DIVERGENTE);
      }
  }
  
  // Rule 4: Check for zero value products, which should have specific CFOPs (not checked here but flagged).
  if (vProd === 0 && qCom > 0) {
      findings.push(INCONSISTENCIES.VALOR_PROD_ZERO);
  }

  const emitUf = item.emitente_uf?.toString().trim().toUpperCase();
  const destUf = item.destinatario_uf?.toString().trim().toUpperCase();

  // Rule 5 & 6: Geo-Fiscal validation (CFOP vs UF)
  if (emitUf && destUf && cfop) {
      if (cfop.startsWith('6')) { // Interstate operation
          if (emitUf === destUf) {
              findings.push(INCONSISTENCIES.CFOP_INTERESTADUAL_UF_INCOMPATIVEL);
          }
      } else if (cfop.startsWith('5')) { // Intrastate operation
          if (emitUf !== destUf) {
              findings.push(INCONSISTENCIES.CFOP_ESTADUAL_UF_INCOMPATIVEL);
          }
      }
  }
  
  const isReturnCfop = cfop.startsWith('12') || cfop.startsWith('22') || cfop.startsWith('52') || cfop.startsWith('62');

  // Rule 7: PIS/COFINS CST validation for returns
  const tributadoNormalmentePisCofins = (cst: string | undefined) => cst && ['01', '02'].includes(cst);

  if (isReturnCfop && (tributadoNormalmentePisCofins(cstPis) || tributadoNormalmentePisCofins(cstCofins))) {
      findings.push(INCONSISTENCIES.PIS_COFINS_CST_INVALIDO_PARA_DEVOLUCAO);
  }

  // Rule 8: ICMS CST validation for returns
  const tributadoNormalmenteIcms = (cst: string | undefined) => cst && ['00', '20'].includes(cst);
  if(isReturnCfop && tributadoNormalmenteIcms(cstIcms)) {
      findings.push(INCONSISTENCIES.ICMS_CST_INVALIDO_PARA_CFOP);
  }

  const vBCIcms = parseSafeFloat(item.produto_base_calculo_icms);
  const pIcms = parseSafeFloat(item.produto_aliquota_icms);
  const vIcms = parseSafeFloat(item.produto_valor_icms);

  // Rule 9: ICMS calculation check
  if (vBCIcms > 0 && pIcms > 0 && vIcms > 0) {
      const calculatedIcms = vBCIcms * (pIcms / 100);
      const difference = Math.abs(calculatedIcms - vIcms);
      // Allow for a small rounding difference (e.g., 1.5 cents) to account for float precision.
      if (difference > 0.015) { 
          findings.push(INCONSISTENCIES.ICMS_CALCULO_DIVERGENTE);
      }
  }


  return findings;
};