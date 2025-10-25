import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import {
  AuditReportSchema,
  ClassificationSchema
} from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

type AuditReport = z.infer<typeof AuditReportSchema>;
type Classification = z.infer<typeof ClassificationSchema>;

const DEFAULT_CONFIDENCE = 0.8;

const selectClassification = (report: AuditReport): Classification => {
  const sector = report.documents[0]?.doc.meta?.tags?.[0] ?? 'Desconhecido';
  return {
    operationType: 'Compra',
    businessSector: sector,
    confidence: DEFAULT_CONFIDENCE
  };
};

export const ClassifierAgent: AgentDefinition<AuditReport, { audit: AuditReport; classification: Classification }> = {
  id: 'A5',
  consumes: 'evt.audit.done',
  produces: 'evt.classification.ready',
  timeoutMs: 10_000,
  maxAttempts: 3,
  async handle(input, context) {
    const startedAt = Date.now();
    const payload = z.object({ audit: AuditReportSchema }).parse(input.payload);
    const auditPayload = payload.audit;

    const classification = selectClassification(auditPayload);

    const enrichedDocuments = auditPayload.documents.map((doc) => ({
      ...doc,
      classification: doc.classification ?? classification
    }));

    const enrichedAudit = {
      ...auditPayload,
      documents: enrichedDocuments
    };

    const headers: EventHeaders = {
      traceId: input.traceId,
      docId: auditPayload.docId,
      idempotencyKey: `${auditPayload.docId}:classified`,
      attempt: 0,
      timestamp: new Date().toISOString()
    };

    const message = createEventMessage('evt.classification.ready', headers, {
      audit: enrichedAudit,
      classification
    });
    await context.enqueue(message);

    return {
      traceId: input.traceId,
      docId: auditPayload.docId,
      result: { audit: enrichedAudit, classification },
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts: input.attempt + 1,
        annotations: {
          confidence: classification.confidence
        }
      },
      followUp: [message]
    };
  }
};
