import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import {
  AuditReportSchema,
  ReconReportSchema
} from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

const ReconDoneSchema = z.object({
  audit: AuditReportSchema,
  recon: ReconReportSchema
});

type ReconDone = z.infer<typeof ReconDoneSchema>;

export const ReportingAgent: AgentDefinition<ReconDone, { audit: z.infer<typeof AuditReportSchema> }> = {
  id: 'A8',
  consumes: 'evt.recon.done',
  produces: 'evt.report.ready',
  timeoutMs: 10_000,
  maxAttempts: 3,
  async handle(input, context) {
    const startedAt = Date.now();
    const payload = ReconDoneSchema.parse(input.payload);

    const finalReport = {
      ...payload.audit,
      reconReport: payload.recon
    };

    const headers: EventHeaders = {
      traceId: input.traceId,
      docId: payload.audit.docId,
      idempotencyKey: `${payload.audit.docId}:report`,
      attempt: 0,
      timestamp: new Date().toISOString()
    };

    await context.kv.put(`report:${payload.audit.docId}`, finalReport, 7 * 24 * 60 * 60);

    const jobKey = `job:${payload.audit.traceId}`;
    const existingJob = await context.kv.get<Record<string, unknown>>(jobKey);
    await context.kv.put(jobKey, {
      ...(existingJob ?? {}),
      status: 'report_ready',
      reportDocId: payload.audit.docId,
      updatedAt: new Date().toISOString()
    }, 7 * 24 * 60 * 60);

    const message = createEventMessage('evt.report.ready', headers, {
      audit: finalReport
    });
    await context.enqueue(message);

    return {
      traceId: input.traceId,
      docId: payload.audit.docId,
      result: { audit: finalReport },
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts: input.attempt + 1
      },
      followUp: [message]
    };
  }
};
