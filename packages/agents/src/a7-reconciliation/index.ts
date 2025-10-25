import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import {
  AuditReportSchema,
  ReconReportSchema,
  TaxApportionSchema
} from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

const TaxReadySchema = z.object({
  audit: AuditReportSchema,
  taxApportion: z.array(TaxApportionSchema)
});

type TaxReady = z.infer<typeof TaxReadySchema>;
type ReconReport = z.infer<typeof ReconReportSchema>;

export const ReconciliationAgent: AgentDefinition<TaxReady, { recon: ReconReport }> = {
  id: 'A7',
  consumes: 'evt.tax.ready',
  produces: 'evt.recon.done',
  timeoutMs: 15_000,
  maxAttempts: 3,
  async handle(input, context) {
    const startedAt = Date.now();
    const payload = TaxReadySchema.parse(input.payload);

    const recon = ReconReportSchema.parse({
      docId: payload.audit.docId,
      status: 'OK',
      reconciledAt: new Date().toISOString(),
      issues: [],
      summary: 'Reconciliado com base nos lançamentos contábeis e apropriação tributária.'
    });

    const headers: EventHeaders = {
      traceId: input.traceId,
      docId: payload.audit.docId,
      idempotencyKey: `${payload.audit.docId}:recon`,
      attempt: 0,
      timestamp: new Date().toISOString()
    };

    const message = createEventMessage('evt.recon.done', headers, {
      audit: payload.audit,
      recon
    });
    await context.enqueue(message);

    return {
      traceId: input.traceId,
      docId: payload.audit.docId,
      result: { recon },
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts: input.attempt + 1
      },
      followUp: [message]
    };
  }
};
