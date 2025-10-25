import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import { DocumentSchema, ParsedDocumentSchema } from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

const IngestPayloadSchema = DocumentSchema;

type IngestPayload = z.infer<typeof IngestPayloadSchema>;
type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;

const PARSER_VERSION = 'ingestor/v1';

export const IngestorAgent: AgentDefinition<IngestPayload, ParsedDocument> = {
  id: 'A1',
  consumes: 'evt.doc.ingested',
  produces: 'evt.doc.parsed',
  timeoutMs: 10_000,
  maxAttempts: 5,
  async handle(input, context) {
    const startedAt = Date.now();
    const document = IngestPayloadSchema.parse(input.payload);

    const idempotencyKey = `ingest:${document.docId}:${input.traceId}`;
    const alreadyProcessed = await context.kv.get<ParsedDocument>(idempotencyKey);
    if (alreadyProcessed) {
      context.logger.info('Skipping ingest due to idempotency hit', { docId: document.docId });
      return {
        traceId: input.traceId,
        docId: document.docId,
        result: alreadyProcessed,
        metrics: {
          durationMs: Date.now() - startedAt,
          attempts: input.attempt + 1,
          annotations: { cached: true }
        }
      };
    }

    const parsed: ParsedDocument = {
      doc: document,
      parsedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      ocrApplied: document.status === 'ocr_needed',
      normalizedText: document.text,
      structuredData: document.data?.map((row, index) => ({
        lineId: `${document.docId}:line:${index}`,
        values: row,
        warnings: []
      })),
      attachments: undefined
    };

    await context.kv.put(idempotencyKey, parsed, 60 * 60);

    const headers: EventHeaders = {
      traceId: input.traceId,
      docId: document.docId,
      idempotencyKey: `${document.docId}:parsed`,
      attempt: 0,
      timestamp: new Date().toISOString()
    };

    const message = createEventMessage('evt.doc.parsed', headers, parsed);
    await context.enqueue(message);

    return {
      traceId: input.traceId,
      docId: document.docId,
      result: parsed,
      metrics: {
        durationMs: Date.now() - startedAt,
        attempts: input.attempt + 1
      },
      followUp: [message]
    };
  }
};
