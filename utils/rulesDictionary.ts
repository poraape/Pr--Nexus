import type { Inconsistency } from '../types';

export const INCONSISTENCIES: Record<string, Inconsistency> = {
    CFOP_SAIDA_EM_COMPRA: {
        code: 'CFOP-INV-01',
        message: 'CFOP de saída (5xxx/6xxx) em operação de compra.',
        explanation: 'O CFOP indica uma Venda/Remessa, mas a empresa é a destinatária. Para compras, o CFOP deveria ser de entrada (1xxx/2xxx). Isso pode indicar erro de digitação ou fraude fiscal.',
        normativeBase: 'Anexo II do Convênio S/Nº, de 15 de dezembro de 1970.',
        severity: 'ERRO'
    },
    NCM_SERVICO_PARA_PRODUTO: {
        code: 'NCM-INV-01',
        message: 'NCM "00000000" usado para um item que parece ser um produto.',
        explanation: 'O NCM "00000000" é reservado para serviços ou itens sem classificação. Se o item é um bem físico, ele deve ter um código NCM específico da tabela TIPI. A classificação incorreta afeta a tributação de IPI e ICMS.',
        normativeBase: 'Tabela de Incidência do IPI (TIPI), aprovada pelo Decreto nº 11.158/2022.',
        severity: 'ALERTA'
    },
    NCM_INVALIDO: {
        code: 'NCM-INV-02',
        message: 'Código NCM possui formato inválido.',
        explanation: 'O NCM deve ser um código de 8 dígitos. Um formato incorreto pode indicar erro de cadastro e levar à rejeição da NFe ou a uma tributação errada.',
        normativeBase: 'Sistema Harmonizado de Designação e de Codificação de Mercadorias.',
        severity: 'ERRO'
    },
    VALOR_CALCULO_DIVERGENTE: {
        code: 'VAL-ERR-01',
        message: 'Valor total do item (vProd) não corresponde a Qtd x Vlr. Unit.',
        explanation: 'A multiplicação da quantidade pelo valor unitário diverge do valor total do produto. Isso pode indicar erros de arredondamento, descontos não informados ou manipulação de valores.',
        normativeBase: 'Princípios contábeis e Art. 476 do Código Civil.',
        severity: 'ERRO'
    },
    VALOR_PROD_ZERO: {
        code: 'VAL-WARN-01',
        message: 'Produto com valor total zerado.',
        explanation: 'O valor total do produto é zero. Isso pode ser uma bonificação, doação ou amostra, que exige um CFOP específico (e.g., 5910/6910) e pode ter tratamento tributário diferenciado.',
        normativeBase: 'RICMS (Regulamento do ICMS) do respectivo estado para operações de bonificação.',
        severity: 'ALERTA'
    },
    CFOP_INTERESTADUAL_UF_INCOMPATIVEL: {
        code: 'CFOP-GEO-01',
        message: 'CFOP interestadual (6xxx) usado em operação com mesma UF de origem e destino.',
        explanation: 'Um CFOP iniciado com 6 indica uma operação interestadual (entre estados diferentes). No entanto, a UF do emitente e do destinatário são as mesmas. Isso pode indicar um erro de digitação no CFOP ou nos endereços.',
        normativeBase: 'Anexo II do Convênio S/Nº, de 15 de dezembro de 1970.',
        severity: 'ERRO'
    },
    CFOP_ESTADUAL_UF_INCOMPATIVEL: {
        code: 'CFOP-GEO-02',
        message: 'CFOP estadual (5xxx) usado em operação com UFs de origem e destino diferentes.',
        explanation: 'Um CFOP iniciado com 5 indica uma operação estadual (dentro do mesmo estado). No entanto, a UF do emitente e do destinatário são diferentes. O CFOP correto para esta operação provavelmente deveria começar com 6.',
        normativeBase: 'Anexo II do Convênio S/Nº, de 15 de dezembro de 1970.',
        severity: 'ERRO'
    },
    PIS_COFINS_CST_INVALIDO_PARA_DEVOLUCAO: {
        code: 'PIS-COFINS-CST-INV-01',
        message: 'CST de PIS/COFINS (tributado) em CFOP de devolução.',
        explanation: 'Operações de devolução (CFOPs 12xx, 22xx, 52xx, 62xx) geralmente devem ter um CST de PIS/COFINS específico, como "98 - Outras Operações de Saída". Um CST de tributação normal (ex: 01) está provavelmente incorreto.',
        normativeBase: 'Lei 10.833/03 (COFINS) e Lei 10.637/02 (PIS).',
        severity: 'ALERTA'
    },
    ICMS_CST_INVALIDO_PARA_CFOP: {
        code: 'ICMS-CST-INV-01',
        message: 'CST de ICMS incompatível com o CFOP da operação.',
        explanation: 'O CST do ICMS indica um tipo de tributação (ex: "00 - Tributada integralmente") que não é compatível com o CFOP de devolução (1.202), que deveria ter um CST não-tributado ou de substituição tributária, por exemplo.',
        normativeBase: 'Anexo I (Códigos de Situação Tributária) do Convênio S/Nº, de 1970.',
        severity: 'ALERTA'
    },
    ICMS_CALCULO_DIVERGENTE: {
        code: 'ICMS-CALC-01',
        message: 'Valor do ICMS (vICMS) não corresponde ao cálculo (vBC x pICMS).',
        explanation: 'O valor do ICMS informado no item diverge do cálculo da Base de Cálculo (vBC) pela Alíquota (pICMS). Isso pode indicar erros de cálculo, arredondamento incorreto ou manipulação fiscal.',
        normativeBase: 'Lei Complementar nº 87/1996 (Lei Kandir).',
        severity: 'ERRO'
    }
};