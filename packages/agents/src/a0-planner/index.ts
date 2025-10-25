import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import { DocumentSchema } from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

const PlannerPayloadSchema = z.object({
  traceId: z.string(),
  tenantId: z.string(),
  documents: z.array(DocumentSchema),
  options: z
    .object({
      priority: z.enum(['low', 'normal', 'high']).default('normal'),
      reprocess: z.boolean().default(false),
      dryRun: z.boolean().default(false)
    })
    .partial()
    .default({})
});

export type PlannerPayload = z.infer<typeof PlannerPayloadSchema>;

type PlannerResult = {
  enqueued: number;
  skipped: number;
};

export const PlannerAgent: AgentDefinition<PlannerPayload, PlannerResult> = {
  id: 'A0',
  consumes: 'evt.pipeline.requested',
  produces: 'evt.doc.ingested',
  timeoutMs: 5000,
  maxAttempts: 3,
  async handle(input, context) {
    const startedAt = Date.now();
    const payload = PlannerPayloadSchema.parse(input.payload);

    const locksAcquired: string[] = [];
    let enqueued = 0;
    let skipped = 0;

    for (const document of payload.documents) {
      const lockKey = `lock:doc:${document.docId}`;
      const hasLock = await context.locks.acquire(lockKey, 60);
      if (!hasLock) {
        skipped += 1;
        continue;
      }
      locksAcquired.push(lockKey);

      const headers: EventHeaders = {
        traceId: payload.traceId,
        docId: document.docId,
        idempotencyKey: `${document.docId}:ingested`,
        attempt: 0,
        timestamp: new Date().toISOString()
      };

      const message = createEventMessage('evt.doc.ingested', headers, document);
      await context.enqueue(message);
      enqueued += 1;
    }

    await Promise.all(
      locksAcquired.map((lock) => context.locks.release(lock).catch((error) => context.logger.warn('Failed to release lock', { lock, error })))
    );

    const durationMs = Date.now() - startedAt;

    return {
      traceId: payload.traceId,
      docId: input.docId,
      result: { enqueued, skipped },
      metrics: {
        durationMs,
        attempts: input.attempt + 1,
        annotations: {
          priority: payload.options.priority ?? 'normal'
        }
      }
    };
  }
};
