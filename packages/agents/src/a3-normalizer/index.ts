import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import {
  NormalizedDocumentSchema,
  NormalizedLineSchema,
  ParsedDocumentSchema
} from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;
type NormalizedDocument = z.infer<typeof NormalizedDocumentSchema>;

export const NormalizerAgent: AgentDefinition<ParsedDocument, NormalizedDocument> = {
  id: 'A3',
  consumes: 'evt.doc.parsed',
  produces: 'evt.doc.normalized',
  timeoutMs: 20_000,
  maxAttempts: 5,
  async handle(input, context) {
    const startedAt = Date.now();
    const parsed = ParsedDocumentSchema.parse(input.payload);

    const normalizedLines = (parsed.structuredData ?? []).map((row, index) =>
      NormalizedLineSchema.parse({
        lineId: row.lineId,
        docId: parsed.doc.docId,
        sequence: index,
        values: row.values,
        normalizedAt: new Date().toISOString(),
        issues: row.warnings ?? []
      })
    );

    const normalized = NormalizedDocumentSchema.parse({
      doc: parsed.doc,
      lines: normalizedLines,
      normalizationVersion: 'normalizer/v1',
      normalizedAt: new Date().toISOString(),
      unitSystem: 'metric',
      currency: 'BRL'
    });

    const headers: EventHeaders = {
      traceId: input.traceId,
      docId: parsed.doc.docId,
      idempotencyKey: `${parsed.doc.docId}:normalized`,
      attempt: 0,
      timestamp: new Date().toISOString()
    };

    const message = createEventMessage('evt.doc.normalized', headers, normalized);
    await context.enqueue(message);

    return {
      traceId: input.traceId,
      docId: parsed.doc.docId,
      result: normalized,
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts: input.attempt + 1,
        annotations: {
          lineCount: normalizedLines.length
        }
      },
      followUp: [message]
    };
  }
};
