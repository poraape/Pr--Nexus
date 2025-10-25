import { z } from 'zod';
import { AuditReportSchema } from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

const AssistantReadySchema = z.object({
  audit: AuditReportSchema,
  knowledgeBase: z.object({
    docId: z.string(),
    embeddingsVersion: z.string(),
    preparedAt: z.string()
  })
});

type AssistantReady = z.infer<typeof AssistantReadySchema>;

export const ObservabilityAgent: AgentDefinition<AssistantReady, { recorded: boolean }> = {
  id: 'A10',
  consumes: 'evt.assistant.ready',
  produces: 'evt.assistant.ready',
  timeoutMs: 5_000,
  maxAttempts: 1,
  async handle(input, context) {
    const startedAt = Date.now();
    const payload = AssistantReadySchema.parse(input.payload);

    context.telemetry.recordMetric('pipeline.finalized', 1, {
      docId: payload.audit.docId
    });

    context.logger.info('Pipeline finalized', {
      docId: payload.audit.docId,
      embeddingsVersion: payload.knowledgeBase.embeddingsVersion
    });

    return {
      traceId: input.traceId,
      docId: payload.audit.docId,
      result: { recorded: true },
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts: input.attempt + 1
      },
      followUp: []
    };
  }
};
