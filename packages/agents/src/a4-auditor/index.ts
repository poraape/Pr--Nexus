import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import {
  AuditReportSchema,
  NormalizedDocumentSchema
} from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

type NormalizedDocument = z.infer<typeof NormalizedDocumentSchema>;
type AuditReport = z.infer<typeof AuditReportSchema>;

export const AuditorAgent: AgentDefinition<NormalizedDocument, { audit: AuditReport }> = {
  id: 'A4',
  consumes: 'evt.doc.normalized',
  produces: 'evt.audit.done',
  timeoutMs: 25_000,
  maxAttempts: 5,
  async handle(input, context) {
    const startedAt = Date.now();
    const normalized = NormalizedDocumentSchema.parse(input.payload);

    const documentCount = normalized.lines.length;
    const audit = AuditReportSchema.parse({
      traceId: input.traceId,
      docId: normalized.doc.docId,
      summary: {
        title: `Relatório ${normalized.doc.name}`,
        summary: `Documento ${normalized.doc.name} processado com ${documentCount} linhas normalizadas.`,
        keyMetrics: [
          {
            metric: 'Linhas Normalizadas',
            value: documentCount,
            insight: 'Quantidade total de linhas estruturadas após a normalização.'
          }
        ],
        actionableInsights: [],
        strategicRecommendations: []
      },
      documents: [
        {
          doc: normalized.doc,
          status: 'OK',
          inconsistencies: [],
          classification: undefined,
          score: 1
        }
      ],
      aggregatedMetrics: {
        lineCount: documentCount
      },
      generatedAt: new Date().toISOString()
    });

    const headers: EventHeaders = {
      traceId: input.traceId,
      docId: normalized.doc.docId,
      idempotencyKey: `${normalized.doc.docId}:audit`,
      attempt: 0,
      timestamp: new Date().toISOString()
    };

    const message = createEventMessage('evt.audit.done', headers, { audit });
    await context.enqueue(message);

    return {
      traceId: input.traceId,
      docId: normalized.doc.docId,
      result: { audit },
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts: input.attempt + 1
      },
      followUp: [message]
    };
  }
};
