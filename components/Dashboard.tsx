import React, { useMemo, useState } from 'react';
import type { AuditReport } from '../types';
import Chart from './Chart';

type OperationCategory = 'entrada' | 'saida' | 'mista' | 'desconhecida';

interface DocContext {
  docKey: string;
  docName: string;
  docStatus: string;
  docKind: string;
  emitenteNome?: string | null;
  emitenteUf?: string | null;
  destinatarioNome?: string | null;
  destinatarioUf?: string | null;
  dataEmissao?: string | null;
  period?: string | null;
  valorTotal: number | null;
  itemTotal: number;
  itemCount: number;
  cfops: string[];
  operation: OperationCategory;
}

interface AnalyticalItem extends Record<string, unknown> {
  __docKey: string;
  __docName: string;
  __docStatus: string;
  __docKind: string;
}

interface Filters {
  period: string;
  emitenteUf: string;
  destinatarioUf: string;
  emitenteNome: string;
  destinatarioNome: string;
  operation: OperationCategory | 'all';
}

type MetricImportance = 'core' | 'alert' | 'optional';
type MetricFormat = 'currency' | 'integer' | 'float';
type MetricCalculation = 'countDocs' | 'countItems' | 'sumDocs' | 'sumItems';
type MetricStatus = 'ok' | 'zero' | 'missing';

interface MetricDefinition {
  id: string;
  label: string;
  description: string;
  importance: MetricImportance;
  format: MetricFormat;
  calculation: MetricCalculation;
  fields?: string[];
  zeroMessage?: string;
  missingMessage?: string;
}

interface MetricResult {
  def: MetricDefinition;
  status: MetricStatus;
  rawValue: number | null;
  formattedValue: string;
  fieldUsed?: string;
  nonNullCount: number;
  zeroCount: number;
  tooltip: string;
}

type FieldType = 'numeric' | 'text';

interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  scope: 'document' | 'item';
}

interface FieldQuality {
  key: string;
  label: string;
  type: FieldType;
  scope: 'document' | 'item';
  total: number;
  nonNull: number;
  zero: number;
  missing: number;
  missingPct: number;
  zeroPct: number;
  severity: 'healthy' | 'monitor' | 'critical';
}

const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: 'doc_count',
    label: 'Documentos analisados',
    description: 'Quantidade de documentos com dados estruturados disponiveis no filtro atual.',
    importance: 'core',
    format: 'integer',
    calculation: 'countDocs',
  },
  {
    id: 'item_count',
    label: 'Itens processados',
    description: 'Quantidade de linhas de itens identificadas apos a integracao dinamica dos arquivos.',
    importance: 'core',
    format: 'integer',
    calculation: 'countItems',
  },
  {
    id: 'nota_total',
    label: 'Valor total das notas',
    description: 'Somatorio dos valores totais das NF-e consolidados por documento.',
    importance: 'core',
    format: 'currency',
    calculation: 'sumDocs',
    zeroMessage: 'Nenhuma nota fiscal apresentou valor monetario.',
    missingMessage: 'Campo de valor da nota nao encontrado nos dados ingeridos.',
  },
  {
    id: 'itens_total',
    label: 'Valor total dos itens',
    description: 'Somatorio dos valores de item registrados (quando disponiveis).',
    importance: 'core',
    format: 'currency',
    calculation: 'sumItems',
    fields: ['produto_valor_total', 'valor_total_item', 'valor_total'],
    zeroMessage: 'Todos os itens possuem valor total igual a zero.',
    missingMessage: 'Campo de valor total do item nao foi identificado.',
  },
  {
    id: 'icms_total',
    label: 'ICMS acumulado',
    description: 'Somatorio do ICMS informado nos itens processados.',
    importance: 'alert',
    format: 'currency',
    calculation: 'sumItems',
    fields: ['produto_valor_icms', 'valor_icms', 'vl_icms'],
    zeroMessage: 'Nenhum item possui ICMS informado.',
    missingMessage: 'Campo de ICMS nao encontrado.',
  },
  {
    id: 'pis_total',
    label: 'PIS acumulado',
    description: 'Somatorio do PIS informado nos itens.',
    importance: 'alert',
    format: 'currency',
    calculation: 'sumItems',
    fields: ['produto_valor_pis', 'valor_pis', 'vl_pis'],
    zeroMessage: 'PIS informado como zero para todos os itens.',
    missingMessage: 'Campo de PIS nao encontrado.',
  },
  {
    id: 'cofins_total',
    label: 'COFINS acumulado',
    description: 'Somatorio do COFINS informado nos itens.',
    importance: 'alert',
    format: 'currency',
    calculation: 'sumItems',
    fields: ['produto_valor_cofins', 'valor_cofins', 'vl_cofins'],
    zeroMessage: 'COFINS informado como zero para todos os itens.',
    missingMessage: 'Campo de COFINS nao encontrado.',
  },
  {
    id: 'iss_total',
    label: 'ISS acumulado',
    description: 'Somatorio do ISS informado nos itens.',
    importance: 'optional',
    format: 'currency',
    calculation: 'sumItems',
    fields: ['produto_valor_iss', 'valor_iss'],
    zeroMessage: 'ISS informado como zero para todos os itens.',
    missingMessage: 'Campo de ISS nao encontrado.',
  },
];

const FIELD_CONFIGS: FieldConfig[] = [
  { key: 'valorTotal', label: 'Valor total da nota', type: 'numeric', scope: 'document' },
  { key: 'emitenteNome', label: 'Emitente', type: 'text', scope: 'document' },
  { key: 'emitenteUf', label: 'UF emitente', type: 'text', scope: 'document' },
  { key: 'destinatarioNome', label: 'Destinatario', type: 'text', scope: 'document' },
  { key: 'destinatarioUf', label: 'UF destinatario', type: 'text', scope: 'document' },
  { key: 'produto_nome', label: 'Descricao do item', type: 'text', scope: 'item' },
  { key: 'produto_ncm', label: 'NCM', type: 'text', scope: 'item' },
  { key: 'produto_cfop', label: 'CFOP', type: 'text', scope: 'item' },
  { key: 'produto_qtd', label: 'Quantidade', type: 'numeric', scope: 'item' },
  { key: 'produto_valor_unit', label: 'Valor unitario', type: 'numeric', scope: 'item' },
  { key: 'produto_valor_total', label: 'Valor total item', type: 'numeric', scope: 'item' },
  { key: 'produto_valor_icms', label: 'ICMS', type: 'numeric', scope: 'item' },
  { key: 'produto_valor_pis', label: 'PIS', type: 'numeric', scope: 'item' },
  { key: 'produto_valor_cofins', label: 'COFINS', type: 'numeric', scope: 'item' },
  { key: 'produto_valor_iss', label: 'ISS', type: 'numeric', scope: 'item' },
];

const OPERATION_LABEL: Record<OperationCategory | 'all', string> = {
  all: 'Todas',
  entrada: 'Entradas',
  saida: 'Saidas',
  mista: 'Mistas',
  desconhecida: 'Nao classificada',
};
const formatCurrency = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatNumber = (value: number | null, maximumFractionDigits = 2): string => {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
};

const isNullish = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  return false;
};

const coerceNumeric = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (!/\d/.test(trimmed)) {
      return null;
    }
    const normalized = trimmed.includes(',')
      ? trimmed.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.')
      : trimmed.replace(/[^\d.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const coerceString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const str = String(value).trim();
  return str === '' ? null : str;
};

const extractPeriod = (value: unknown): string | null => {
  const raw = coerceString(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.replace('T', ' ').replace('Z', ' ');
  const isoCandidate = normalized.includes(' ') ? normalized.replace(' ', 'T') : normalized;
  const parsed = Number.isNaN(Date.parse(isoCandidate)) ? undefined : new Date(isoCandidate);
  if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    return `${parsed.getFullYear()}-${month}`;
  }
  const match = normalized.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (match) {
    return `${match[3]}-${match[2]}`;
  }
  const yearMatch = normalized.match(/(\d{4})/);
  if (yearMatch) {
    return `${yearMatch[1]}-00`;
  }
  return null;
};

const categorizeCfop = (cfop: string): OperationCategory => {
  if (!cfop) {
    return 'desconhecida';
  }
  const firstDigit = cfop.trim()[0];
  if (['1', '2', '3'].includes(firstDigit)) {
    return 'entrada';
  }
  if (['5', '6', '7'].includes(firstDigit)) {
    return 'saida';
  }
  return 'desconhecida';
};

const resolveOperation = (cfops: Set<string>): OperationCategory => {
  let hasEntrada = false;
  let hasSaida = false;
  cfops.forEach(cfop => {
    const category = categorizeCfop(cfop);
    if (category === 'entrada') {
      hasEntrada = true;
    } else if (category === 'saida') {
      hasSaida = true;
    }
  });
  if (hasEntrada && hasSaida) {
    return 'mista';
  }
  if (hasEntrada) {
    return 'entrada';
  }
  if (hasSaida) {
    return 'saida';
  }
  return 'desconhecida';
};
const mergeDocContexts = (report: AuditReport | null) => {
  const docMap = new Map<string, DocContext>();
  const items: AnalyticalItem[] = [];

  if (!report) {
    return { docContexts: [] as DocContext[], items };
  }

  report.documents.forEach(document => {
    const rows = document.doc?.data ?? [];
    const docName = document.doc?.name ?? 'Documento';
    const docKind = document.doc?.kind ?? 'UNKNOWN';

    rows.forEach((rawRow, index) => {
      if (!rawRow || typeof rawRow !== 'object') {
        return;
      }
      const row = rawRow as Record<string, unknown>;
      const docKeySource = coerceString(row.nfe_id);
      const docKey = docKeySource ?? `${docName}#${index}`;
      let ctx = docMap.get(docKey);
      if (!ctx) {
        ctx = {
          docKey,
          docName,
          docStatus: document.status,
          docKind,
          emitenteNome: null,
          emitenteUf: null,
          destinatarioNome: null,
          destinatarioUf: null,
          dataEmissao: null,
          period: null,
          valorTotal: null,
          itemTotal: 0,
          itemCount: 0,
          cfops: [],
          operation: 'desconhecida',
        };
        docMap.set(docKey, ctx);
      }

      const emitenteNome = coerceString(row.emitente_nome ?? row.emitenteNome);
      if (!ctx.emitenteNome && emitenteNome) {
        ctx.emitenteNome = emitenteNome;
      }
      const emitenteUf = coerceString(row.emitente_uf ?? row.emitenteUf);
      if (!ctx.emitenteUf && emitenteUf) {
        ctx.emitenteUf = emitenteUf.toUpperCase();
      }
      const destinatarioNome = coerceString(row.destinatario_nome ?? row.destinatarioNome);
      if (!ctx.destinatarioNome && destinatarioNome) {
        ctx.destinatarioNome = destinatarioNome;
      }
      const destinatarioUf = coerceString(row.destinatario_uf ?? row.destinatarioUf);
      if (!ctx.destinatarioUf && destinatarioUf) {
        ctx.destinatarioUf = destinatarioUf.toUpperCase();
      }
      const dataEmissao = coerceString(row.data_emissao ?? row.dataEmissao);
      if (!ctx.dataEmissao && dataEmissao) {
        ctx.dataEmissao = dataEmissao;
        ctx.period = extractPeriod(dataEmissao);
      }

      const notaTotal = coerceNumeric(row.valor_total_nfe ?? row.valorTotal);
      if (notaTotal !== null) {
        if (ctx.valorTotal === null || notaTotal > ctx.valorTotal) {
          ctx.valorTotal = notaTotal;
        }
      }

      const itemTotal = coerceNumeric(row.produto_valor_total ?? row.valor_total);
      if (itemTotal !== null) {
        ctx.itemTotal += itemTotal;
      }

      const cfop = coerceString(row.produto_cfop ?? row.cfop);
      if (cfop) {
        ctx.cfops.push(cfop);
      }

      const hasItemSignals =
        coerceString(row.produto_nome) ||
        coerceNumeric(row.produto_valor_total) !== null ||
        coerceNumeric(row.produto_qtd) !== null ||
        coerceString(row.produto_ncm);

      if (hasItemSignals) {
        ctx.itemCount += 1;
        const item: AnalyticalItem = {
          ...row,
          __docKey: docKey,
          __docName: docName,
          __docStatus: document.status,
          __docKind: docKind,
        };

        if (!item.destinatario_nome && ctx.destinatarioNome) {
          item.destinatario_nome = ctx.destinatarioNome;
        }
        if (!item.destinatario_uf && ctx.destinatarioUf) {
          item.destinatario_uf = ctx.destinatarioUf;
        }
        if (!item.emitente_nome && ctx.emitenteNome) {
          item.emitente_nome = ctx.emitenteNome;
        }
        if (!item.emitente_uf && ctx.emitenteUf) {
          item.emitente_uf = ctx.emitenteUf;
        }
        if (!item.data_emissao && ctx.dataEmissao) {
          item.data_emissao = ctx.dataEmissao;
        }

        items.push(item);
      }
    });
  });

  const docContexts: DocContext[] = Array.from(docMap.values()).map(ctx => {
    const cfopSet = new Set(ctx.cfops.filter(Boolean));
    const operation = resolveOperation(cfopSet);
    let valorTotal = ctx.valorTotal;
    if ((valorTotal === null || valorTotal === 0) && ctx.itemTotal > 0) {
      valorTotal = ctx.itemTotal;
    }
    return {
      ...ctx,
      cfops: Array.from(cfopSet),
      valorTotal,
      operation,
    };
  });

  return { docContexts, items };
};
const metricFormatter: Record<MetricFormat, (value: number | null) => string> = {
  currency: formatCurrency,
  integer: value => formatNumber(value, 0),
  float: value => formatNumber(value, 2),
};

const buildMetricTooltip = (metric: MetricDefinition, status: MetricStatus, nonNull: number, zero: number, total: number): string => {
  if (status === 'missing') {
    return metric.missingMessage ?? 'O sistema nao conseguiu localizar dados para esta metrica.';
  }
  if (status === 'zero') {
    return (
      metric.zeroMessage ??
      `Todos os ${nonNull} registros encontrados apresentam valor zero.`
    );
  }
  const coverage = total > 0 ? Math.round((nonNull / total) * 100) : 0;
  return `${coverage}% dos registros contribuem para esta metrica. Zeros identificados: ${zero}.`;
};

const calculateMetrics = (
  docs: DocContext[],
  items: AnalyticalItem[],
): MetricResult[] => {
  return METRIC_DEFINITIONS.map(def => {
    let rawValue: number | null = null;
    let nonNullCount = 0;
    let zeroCount = 0;
    let fieldUsed: string | undefined;

    if (def.calculation === 'countDocs') {
      rawValue = docs.length;
      nonNullCount = docs.length;
    } else if (def.calculation === 'countItems') {
      rawValue = items.length;
      nonNullCount = items.length;
    } else if (def.calculation === 'sumDocs') {
      docs.forEach(doc => {
        const value = doc.valorTotal;
        if (value !== null) {
          nonNullCount += 1;
          if (value === 0) {
            zeroCount += 1;
          }
          rawValue = (rawValue ?? 0) + value;
        }
      });
      if (rawValue === null && nonNullCount === 0) {
        rawValue = null;
      }
    } else if (def.calculation === 'sumItems') {
      const candidateFields = def.fields ?? [];
      for (const field of candidateFields) {
        let candidateValue: number | null = null;
        let candidateNonNull = 0;
        let candidateZero = 0;
        items.forEach(item => {
          const numeric = coerceNumeric(item[field]);
          if (numeric !== null) {
            candidateNonNull += 1;
            if (numeric === 0) {
              candidateZero += 1;
            }
            candidateValue = (candidateValue ?? 0) + numeric;
          }
        });
        if (candidateNonNull > 0) {
          rawValue = candidateValue ?? 0;
          nonNullCount = candidateNonNull;
          zeroCount = candidateZero;
          fieldUsed = field;
          break;
        }
      }
    }

    const totalReference =
      def.calculation === 'countItems' || def.calculation === 'sumItems' ? items.length : docs.length;

    let status: MetricStatus = 'missing';
    if (nonNullCount === 0) {
      status = 'missing';
      rawValue = null;
    } else if ((rawValue ?? 0) === 0) {
      status = 'zero';
      rawValue = 0;
    } else {
      status = 'ok';
    }

    const formattedValue = metricFormatter[def.format](rawValue);
    const tooltip = buildMetricTooltip(def, status, nonNullCount, zeroCount, totalReference);

    return {
      def,
      status,
      rawValue,
      formattedValue,
      fieldUsed,
      nonNullCount,
      zeroCount,
      tooltip,
    };
  });
};
const calculateFieldQuality = (
  docs: DocContext[],
  items: AnalyticalItem[],
): FieldQuality[] => {
  return FIELD_CONFIGS.map(config => {
    let total = 0;
    let nonNull = 0;
    let zero = 0;

    if (config.scope === 'document') {
      total = docs.length;
      docs.forEach(doc => {
        const value = (doc as unknown as Record<string, unknown>)[config.key];
        if (config.type === 'text') {
          if (!isNullish(value)) {
            nonNull += 1;
          }
        } else {
          const numeric = coerceNumeric(value);
          if (numeric !== null) {
            nonNull += 1;
            if (numeric === 0) {
              zero += 1;
            }
          }
        }
      });
    } else {
      total = items.length;
      items.forEach(item => {
        const value = item[config.key];
        if (config.type === 'text') {
          if (!isNullish(value)) {
            nonNull += 1;
          }
        } else {
          const numeric = coerceNumeric(value);
          if (numeric !== null) {
            nonNull += 1;
            if (numeric === 0) {
              zero += 1;
            }
          }
        }
      });
    }

    const missing = Math.max(total - nonNull, 0);
    const missingPct = total > 0 ? (missing / total) * 100 : 100;
    const zeroPct = total > 0 ? (zero / total) * 100 : 0;

    let severity: FieldQuality['severity'] = 'healthy';
    if (missingPct >= 50 || zeroPct >= 90) {
      severity = 'critical';
    } else if (missingPct >= 20 || zeroPct >= 50) {
      severity = 'monitor';
    }

    return {
      key: config.key,
      label: config.label,
      type: config.type,
      scope: config.scope,
      total,
      nonNull,
      zero,
      missing,
      missingPct,
      zeroPct,
      severity,
    };
  });
};

const matchesFilters = (ctx: DocContext, filters: Filters): boolean => {
  if (filters.period !== 'all') {
    const period = ctx.period ?? 'desconhecido';
    if (period !== filters.period) {
      return false;
    }
  }
  if (filters.emitenteUf !== 'all' && (ctx.emitenteUf ?? '')) {
    if (ctx.emitenteUf !== filters.emitenteUf) {
      return false;
    }
  } else if (filters.emitenteUf !== 'all' && !ctx.emitenteUf) {
    return false;
  }

  if (filters.destinatarioUf !== 'all' && (ctx.destinatarioUf ?? '')) {
    if (ctx.destinatarioUf !== filters.destinatarioUf) {
      return false;
    }
  } else if (filters.destinatarioUf !== 'all' && !ctx.destinatarioUf) {
    return false;
  }

  if (filters.emitenteNome !== 'all') {
    const emitente = ctx.emitenteNome ?? '';
    if (emitente !== filters.emitenteNome) {
      return false;
    }
  }

  if (filters.destinatarioNome !== 'all') {
    const destinatario = ctx.destinatarioNome ?? '';
    if (destinatario !== filters.destinatarioNome) {
      return false;
    }
  }

  if (filters.operation !== 'all') {
    if (ctx.operation !== filters.operation) {
      return false;
    }
  }

  return true;
};

const collectOptions = (values: (string | null | undefined)[]): string[] => {
  const set = new Set<string>();
  values.forEach(value => {
    if (!value) {
      return;
    }
    set.add(value);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

const mergeCharts = (docs: DocContext[], items: AnalyticalItem[]) => {
  const charts = [];

  const totalPorEmitente = new Map<string, number>();
  docs.forEach(doc => {
    if (!doc.emitenteUf || doc.valorTotal === null) {
      return;
    }
    totalPorEmitente.set(doc.emitenteUf, (totalPorEmitente.get(doc.emitenteUf) ?? 0) + doc.valorTotal);
  });
  if (totalPorEmitente.size > 0) {
    charts.push({
      type: 'bar' as const,
      title: 'Totais por UF do emitente',
      data: Array.from(totalPorEmitente.entries()).map(([label, value]) => ({ label, value })),
      yAxisLabel: 'Valor (BRL)',
    });
  }

  const totalPorDestinatario = new Map<string, number>();
  docs.forEach(doc => {
    if (!doc.destinatarioUf || doc.valorTotal === null) {
      return;
    }
    totalPorDestinatario.set(
      doc.destinatarioUf,
      (totalPorDestinatario.get(doc.destinatarioUf) ?? 0) + doc.valorTotal,
    );
  });
  if (totalPorDestinatario.size > 0) {
    charts.push({
      type: 'bar' as const,
      title: 'Totais por UF do destinatario',
      data: Array.from(totalPorDestinatario.entries()).map(([label, value]) => ({ label, value })),
      yAxisLabel: 'Valor (BRL)',
    });
  }

  const totalPorMes = new Map<string, number>();
  docs.forEach(doc => {
    if (!doc.period || doc.valorTotal === null) {
      return;
    }
    totalPorMes.set(doc.period, (totalPorMes.get(doc.period) ?? 0) + doc.valorTotal);
  });
  if (totalPorMes.size > 0) {
    const ordered = Array.from(totalPorMes.entries()).sort(([a], [b]) => a.localeCompare(b));
    charts.push({
      type: 'line' as const,
      title: 'Evolucao mensal (valor total)',
      data: ordered.map(([label, value]) => ({ label, value })),
      yAxisLabel: 'Valor (BRL)',
      xAxisLabel: 'Periodo (AAAA-MM)',
    });
  }

  const totalPorProduto = new Map<string, number>();
  items.forEach(item => {
    const nome = coerceString(item.produto_nome) ?? 'Sem descricao';
    const valor = coerceNumeric(item.produto_valor_total);
    if (valor !== null && valor > 0) {
      totalPorProduto.set(nome, (totalPorProduto.get(nome) ?? 0) + valor);
    }
  });
  if (totalPorProduto.size > 0) {
    const ordered = Array.from(totalPorProduto.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12);
    charts.push({
      type: 'bar' as const,
      title: 'Top produtos por valor',
      data: ordered.map(([label, value]) => ({ label, value })),
      yAxisLabel: 'Valor (BRL)',
    });
  }

  const tributos = [
    { label: 'ICMS', total: 0 },
    { label: 'PIS', total: 0 },
    { label: 'COFINS', total: 0 },
    { label: 'ISS', total: 0 },
  ];
  items.forEach(item => {
    const icms = coerceNumeric(item.produto_valor_icms);
    if (icms) {
      tributos[0].total += icms;
    }
    const pis = coerceNumeric(item.produto_valor_pis);
    if (pis) {
      tributos[1].total += pis;
    }
    const cofins = coerceNumeric(item.produto_valor_cofins);
    if (cofins) {
      tributos[2].total += cofins;
    }
    const iss = coerceNumeric(item.produto_valor_iss);
    if (iss) {
      tributos[3].total += iss;
    }
  });
  const tributosComValor = tributos.filter(entry => entry.total > 0);
  if (tributosComValor.length > 0) {
    charts.push({
      type: 'pie' as const,
      title: 'Distribuicao de tributos',
      data: tributosComValor.map(entry => ({ label: entry.label, value: entry.total })),
    });
  }

  return charts;
};
const statusColors: Record<MetricStatus, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  zero: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  missing: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
};

const importanceBadge: Record<MetricImportance, string> = {
  core: 'text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/20 text-blue-200',
  alert: 'text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-200',
  optional: 'text-xs font-semibold px-2 py-1 rounded-full bg-slate-500/20 text-slate-200',
};

const severityColors: Record<FieldQuality['severity'], string> = {
  healthy: 'text-emerald-300',
  monitor: 'text-amber-300',
  critical: 'text-rose-300',
};

const FieldQualityBadge: React.FC<{ quality: FieldQuality }> = ({ quality }) => {
  const label =
    quality.severity === 'critical'
      ? 'Critico'
      : quality.severity === 'monitor'
        ? 'Monitorar'
        : 'Saudavel';

  return (
    <span
      className={`text-xs font-semibold px-2 py-1 rounded-full border ${quality.severity === 'healthy' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : quality.severity === 'monitor' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`}
      title={`Nao nulos: ${quality.nonNull} | Zeros: ${quality.zero} | Ausentes: ${quality.missing}`}
    >
      {label}
    </span>
  );
};

const MetricCard: React.FC<{ metric: MetricResult }> = ({ metric }) => {
  return (
    <div
      className={`border rounded-lg p-4 bg-gray-800/60 shadow-sm transition-colors`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={importanceBadge[metric.def.importance]}>{metric.def.importance.toUpperCase()}</span>
        <span className={`text-xs font-semibold px-2 py-1 rounded-md border ${statusColors[metric.status]}`} title={metric.tooltip}>
          {metric.status === 'ok' ? 'OK' : metric.status === 'zero' ? 'Zero detectado' : 'Sem dado'}
        </span>
      </div>
      <h3 className="text-lg font-semibold text-gray-100 mb-2">{metric.def.label}</h3>
      <p className={`text-2xl font-bold ${metric.status === 'missing' ? 'text-rose-200' : metric.status === 'zero' ? 'text-amber-200' : 'text-emerald-200'}`} title={metric.tooltip}>
        {metric.formattedValue}
      </p>
      {metric.fieldUsed && (
        <p className="text-xs text-gray-400 mt-1">
          Campo utilizado: <span className="font-mono">{metric.fieldUsed}</span>
        </p>
      )}
      <p className="text-sm text-gray-400 mt-3 leading-snug">{metric.def.description}</p>
    </div>
  );
};
const DataQualityTable: React.FC<{ data: FieldQuality[] }> = ({ data }) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-left border border-gray-700/60 rounded-lg overflow-hidden">
        <thead className="bg-gray-800/80">
          <tr>
            <th className="px-3 py-2 font-semibold text-gray-200">Campo</th>
            <th className="px-3 py-2 font-semibold text-gray-200">Escopo</th>
            <th className="px-3 py-2 font-semibold text-gray-200 text-right">Cobertura</th>
            <th className="px-3 py-2 font-semibold text-gray-200 text-right">Zeros</th>
            <th className="px-3 py-2 font-semibold text-gray-200 text-right">Ausentes</th>
            <th className="px-3 py-2 font-semibold text-gray-200 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row.key} className="border-t border-gray-700/40">
              <td className="px-3 py-2 text-gray-200">{row.label}</td>
              <td className="px-3 py-2 text-gray-400">{row.scope === 'document' ? 'Documento' : 'Item'}</td>
              <td className="px-3 py-2 text-right text-gray-300">
                {row.total === 0 ? '--' : `${formatNumber(row.nonNull, 0)} (${row.missingPct >= 100 ? 0 : (100 - row.missingPct).toFixed(1)}%)`}
              </td>
              <td className="px-3 py-2 text-right text-gray-300">
                {row.total === 0 ? '--' : `${formatNumber(row.zero, 0)} (${row.zeroPct.toFixed(1)}%)`}
              </td>
              <td className="px-3 py-2 text-right text-gray-300">
                {row.total === 0 ? '--' : `${formatNumber(row.missing, 0)} (${row.missingPct.toFixed(1)}%)`}
              </td>
              <td className="px-3 py-2 text-center">
                <FieldQualityBadge quality={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const PlaceholderBadge: React.FC<{ value: unknown }> = ({ value }) => {
  if (isNullish(value)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-rose-500/10 text-rose-200 border border-rose-500/40" title="Campo nao fornecido.">
        Sem dado
      </span>
    );
  }
  const numeric = coerceNumeric(value);
  if (numeric !== null && numeric === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-amber-500/10 text-amber-200 border border-amber-500/40" title="Valor informado igual a zero.">
        Zero
      </span>
    );
  }
  return null;
};

const SampleTable: React.FC<{ items: AnalyticalItem[] }> = ({ items }) => {
  const sample = items.slice(0, 10);
  if (sample.length === 0) {
    return (
      <div className="text-sm text-gray-400 p-4 border border-dashed border-gray-700/60 rounded-lg">
        Nenhum item encontrado com os filtros atuais.
      </div>
    );
  }
  const columns: { key: string; label: string }[] = [
    { key: 'produto_nome', label: 'Item' },
    { key: 'produto_ncm', label: 'NCM' },
    { key: 'produto_cfop', label: 'CFOP' },
    { key: 'produto_qtd', label: 'Qtd' },
    { key: 'produto_valor_unit', label: 'Valor unitario' },
    { key: 'produto_valor_total', label: 'Valor total' },
    { key: 'emitente_nome', label: 'Emitente' },
    { key: 'destinatario_nome', label: 'Destinatario' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-left border border-gray-700/60 rounded-lg overflow-hidden">
        <thead className="bg-gray-800/80">
          <tr>
            {columns.map(col => (
              <th key={col.key} className="px-3 py-2 font-semibold text-gray-200">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.map((item, rowIndex) => (
            <tr key={`${item.__docKey}-${rowIndex}`} className="border-t border-gray-700/40">
              {columns.map(col => {
                const value = item[col.key];
                const badge = <PlaceholderBadge value={value} />;
                let displayValue: string;
                if (col.key.startsWith('produto_valor')) {
                  displayValue = formatCurrency(coerceNumeric(value));
                } else if (col.key === 'produto_qtd') {
                  displayValue = formatNumber(coerceNumeric(value), 3);
                } else {
                  displayValue = coerceString(value) ?? '--';
                }
                return (
                  <td key={col.key} className="px-3 py-2 text-gray-200">
                    <div className="flex items-center gap-2">
                      <span>{displayValue}</span>
                      {badge}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
const Dashboard: React.FC<{ report: AuditReport | null }> = ({ report }) => {
  const { docContexts, items } = useMemo(() => mergeDocContexts(report), [report]);

  const periodOptions = useMemo(() => ['all', ...collectOptions(docContexts.map(doc => doc.period ?? null))], [docContexts]);
  const emitenteUfOptions = useMemo(() => ['all', ...collectOptions(docContexts.map(doc => doc.emitenteUf ?? null))], [docContexts]);
  const destinatarioUfOptions = useMemo(() => ['all', ...collectOptions(docContexts.map(doc => doc.destinatarioUf ?? null))], [docContexts]);
  const emitenteNomeOptions = useMemo(() => ['all', ...collectOptions(docContexts.map(doc => doc.emitenteNome ?? null))], [docContexts]);
  const destinatarioNomeOptions = useMemo(() => ['all', ...collectOptions(docContexts.map(doc => doc.destinatarioNome ?? null))], [docContexts]);

  const [filters, setFilters] = useState<Filters>({
    period: 'all',
    emitenteUf: 'all',
    destinatarioUf: 'all',
    emitenteNome: 'all',
    destinatarioNome: 'all',
    operation: 'all',
  });

  const filteredDocs = useMemo(
    () => docContexts.filter(doc => matchesFilters(doc, filters)),
    [docContexts, filters],
  );

  const filteredDocKeys = useMemo(() => new Set(filteredDocs.map(doc => doc.docKey)), [filteredDocs]);
  const filteredItems = useMemo(
    () => items.filter(item => filteredDocKeys.has(item.__docKey)),
    [items, filteredDocKeys],
  );

  const metrics = useMemo(() => calculateMetrics(filteredDocs, filteredItems), [filteredDocs, filteredItems]);
  const fieldQuality = useMemo(() => calculateFieldQuality(filteredDocs, filteredItems), [filteredDocs, filteredItems]);
  const charts = useMemo(() => mergeCharts(filteredDocs, filteredItems), [filteredDocs, filteredItems]);

  const criticalFields = fieldQuality.filter(field => field.severity !== 'healthy');

  return (
    <div className="space-y-8">
      <section className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-4 md:p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-gray-100 mb-4">Filtros dinamicos</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="flex flex-col text-sm text-gray-300">
            Periodo
            <select
              className="mt-1 bg-gray-900/80 border border-gray-700 rounded-md px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.period}
              onChange={event => setFilters(prev => ({ ...prev, period: event.target.value }))}
            >
              {periodOptions.map(option => (
                <option key={option} value={option}>
                  {option === 'all' ? 'Todos os periodos' : option === 'desconhecido' ? 'Sem data' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm text-gray-300">
            UF emitente
            <select
              className="mt-1 bg-gray-900/80 border border-gray-700 rounded-md px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.emitenteUf}
              onChange={event => setFilters(prev => ({ ...prev, emitenteUf: event.target.value }))}
            >
              {emitenteUfOptions.map(option => (
                <option key={option} value={option}>
                  {option === 'all' ? 'Todas as UF' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm text-gray-300">
            UF destinatario
            <select
              className="mt-1 bg-gray-900/80 border border-gray-700 rounded-md px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.destinatarioUf}
              onChange={event => setFilters(prev => ({ ...prev, destinatarioUf: event.target.value }))}
            >
              {destinatarioUfOptions.map(option => (
                <option key={option} value={option}>
                  {option === 'all' ? 'Todas as UF' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm text-gray-300">
            Emitente
            <select
              className="mt-1 bg-gray-900/80 border border-gray-700 rounded-md px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.emitenteNome}
              onChange={event => setFilters(prev => ({ ...prev, emitenteNome: event.target.value }))}
            >
              {emitenteNomeOptions.map(option => (
                <option key={option} value={option}>
                  {option === 'all' ? 'Todos' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm text-gray-300">
            Destinatario
            <select
              className="mt-1 bg-gray-900/80 border border-gray-700 rounded-md px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.destinatarioNome}
              onChange={event => setFilters(prev => ({ ...prev, destinatarioNome: event.target.value }))}
            >
              {destinatarioNomeOptions.map(option => (
                <option key={option} value={option}>
                  {option === 'all' ? 'Todos' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm text-gray-300">
            Tipo de operacao
            <select
              className="mt-1 bg-gray-900/80 border border-gray-700 rounded-md px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filters.operation}
              onChange={event => setFilters(prev => ({ ...prev, operation: event.target.value as Filters['operation'] }))}
            >
              {(['all', 'entrada', 'saida', 'mista', 'desconhecida'] as const).map(option => (
                <option key={option} value={option}>
                  {OPERATION_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-400">
          <span>Documentos ativos: <strong className="text-gray-200">{filteredDocs.length}</strong></span>
          <span>Itens visiveis: <strong className="text-gray-200">{filteredItems.length}</strong></span>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-100 mb-4">Metricas chave</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {metrics.map(metric => (
            <MetricCard key={metric.def.id} metric={metric} />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {charts.map(chart => (
          <div key={chart.title} className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-4">
            <Chart {...chart} />
          </div>
        ))}
        {charts.length === 0 && (
          <div className="col-span-full border border-dashed border-gray-700/60 rounded-lg p-6 text-center text-gray-400">
            Nao ha dados suficientes para construir visualizacoes com os filtros atuais.
          </div>
        )}
      </section>

      <section className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-4 md:p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-100 mb-2">Qualidade dos dados</h2>
          <p className="text-sm text-gray-400">
            Avaliacao automatica da cobertura e consistencia das colunas disponiveis apos a integracao dos arquivos.
          </p>
        </div>
        <DataQualityTable data={fieldQuality} />
        {criticalFields.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-2">
            <h3 className="text-sm font-semibold text-amber-200 uppercase tracking-wide">Pontos de atencao</h3>
            <ul className="list-disc list-inside text-sm text-amber-100 space-y-1">
              {criticalFields.map(field => (
                <li key={field.key}>
                  {field.label}: {field.severity === 'critical' ? 'dados ausentes em grande volume' : 'cobertura parcial ou muitos zeros'} ({field.scope === 'document' ? 'documento' : 'item'}).
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-4 md:p-6">
        <h2 className="text-xl font-semibold text-gray-100 mb-4">Amostra dos itens</h2>
        <SampleTable items={filteredItems} />
      </section>
    </div>
  );
};

export default Dashboard;
