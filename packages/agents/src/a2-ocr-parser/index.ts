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

const NormalizerInputSchema = ParsedDocumentSchema;

export const OcrParserAgent: AgentDefinition<ParsedDocument, NormalizedDocument> = {
  id: 'A2',
  consumes: 'evt.doc.parsed',
  produces: 'evt.doc.normalized',
  timeoutMs: 15_000,
  maxAttempts: 5,
  async handle(input, context) {
    const startedAt = Date.now();
    const parsedDoc = NormalizerInputSchema.parse(input.payload);

    const normalizedLines = (parsedDoc.structuredData ?? []).map((row, index) =>
      NormalizedLineSchema.parse({
        lineId: row.lineId,
        docId: parsedDoc.doc.docId,
        sequence: index,
        values: row.values,
        normalizedAt: new Date().toISOString(),
        issues: row.warnings ?? []
      })
    );

    const normalizedDoc = NormalizedDocumentSchema.parse({
      doc: parsedDoc.doc,
      lines: normalizedLines,
      normalizationVersion: 'normalizer/v1',
      normalizedAt: new Date().toISOString(),
      unitSystem: 'metric',
      currency: 'BRL'
    });

    const headers: EventHeaders = {
      traceId: input.traceId,
      docId: parsedDoc.doc.docId,
      idempotencyKey: `${parsedDoc.doc.docId}:normalized`,
      attempt: 0,
      timestamp: new Date().toISOString()
    };

    const message = createEventMessage('evt.doc.normalized', headers, normalizedDoc);
    await context.enqueue(message);

    return {
      traceId: input.traceId,
      docId: parsedDoc.doc.docId,
      result: normalizedDoc,
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
