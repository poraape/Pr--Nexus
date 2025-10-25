import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import { AuditReportSchema } from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

const ReportReadySchema = z.object({
  audit: AuditReportSchema
});

type ReportReady = z.infer<typeof ReportReadySchema>;

export const AssistantAgent: AgentDefinition<ReportReady, { knowledgeBase: { docId: string; embeddingsVersion: string; preparedAt: string } }> = {
  id: 'A9',
  consumes: 'evt.report.ready',
  produces: 'evt.assistant.ready',
  timeoutMs: 8_000,
  maxAttempts: 2,
  async handle(input, context) {
    const startedAt = Date.now();
    const payload = ReportReadySchema.parse(input.payload);

    const knowledgeBase = {
      docId: payload.audit.docId,
      embeddingsVersion: 'kb/v1',
      preparedAt: new Date().toISOString()
    };

    // Persist context for chat assist
    await context.kv.put(`assistant:${payload.audit.docId}`, knowledgeBase, 24 * 60 * 60);

    const headers: EventHeaders = {
      traceId: input.traceId,
      docId: payload.audit.docId,
      idempotencyKey: `${payload.audit.docId}:assistant`,
      attempt: 0,
      timestamp: new Date().toISOString()
    };

    const message = createEventMessage('evt.assistant.ready', headers, {
      audit: payload.audit,
      knowledgeBase
    });
    await context.enqueue(message);

    return {
      traceId: input.traceId,
      docId: payload.audit.docId,
      result: { knowledgeBase },
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts: input.attempt + 1
      },
      followUp: [message]
    };
  }
};
