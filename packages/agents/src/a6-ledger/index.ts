import { z } from 'zod';
import { createEventMessage, EventHeaders } from '@pr-nexus/contracts';
import {
  AuditReportSchema,
  LedgerEntrySchema,
  TaxApportionSchema
} from '@pr-nexus/schemas';
import type { AgentDefinition } from '../core';

const ClassificationReadySchema = z.object({
  audit: AuditReportSchema,
  classification: z.object({
    operationType: z.string(),
    businessSector: z.string(),
    confidence: z.number()
  })
});

type ClassificationReady = z.infer<typeof ClassificationReadySchema>;

export const LedgerAgent: AgentDefinition<ClassificationReady, { ledgerEntries: z.infer<typeof LedgerEntrySchema>[]; taxApportion: z.infer<typeof TaxApportionSchema>[] }> =
  {
    id: 'A6',
    consumes: 'evt.classification.ready',
    produces: ['evt.ledger.ready', 'evt.tax.ready'],
    timeoutMs: 15_000,
    maxAttempts: 3,
    async handle(input, context) {
      const startedAt = Date.now();
      const payload = ClassificationReadySchema.parse(input.payload);

      const ledgerEntries = payload.audit.documents.map((doc, index) =>
        LedgerEntrySchema.parse({
          docId: doc.doc.docId,
          entryId: `${doc.doc.docId}:entry:${index}`,
          account: '1.1.2 Estoques',
          type: 'D',
          amount: 0,
          currency: 'BRL',
          memo: 'Placeholder ledger entry'
        })
      );

      const taxApportion = payload.audit.documents.map((doc) =>
        TaxApportionSchema.parse({
          docId: doc.doc.docId,
          taxType: 'ICMS',
          jurisdiction: 'BR',
          basisAmount: 0,
          taxAmount: 0,
          confidence: 0.5,
          methodology: 'baseline'
        })
      );

      const ledgerHeaders: EventHeaders = {
        traceId: input.traceId,
        docId: payload.audit.docId,
        idempotencyKey: `${payload.audit.docId}:ledger`,
        attempt: 0,
        timestamp: new Date().toISOString()
      };

      const taxHeaders: EventHeaders = {
        traceId: input.traceId,
        docId: payload.audit.docId,
        idempotencyKey: `${payload.audit.docId}:tax`,
        attempt: 0,
        timestamp: new Date().toISOString()
      };

      const ledgerMessage = createEventMessage('evt.ledger.ready', ledgerHeaders, {
        audit: payload.audit,
        ledgerEntries
      });
      const taxMessage = createEventMessage('evt.tax.ready', taxHeaders, {
        audit: payload.audit,
        taxApportion
      });

      await Promise.all([context.enqueue(ledgerMessage), context.enqueue(taxMessage)]);

      return {
        traceId: input.traceId,
        docId: payload.audit.docId,
        result: { ledgerEntries, taxApportion },
        metrics: {
          durationMs: Date.now() - startedAt,
          attempts: input.attempt + 1
        },
        followUp: [ledgerMessage, taxMessage]
      };
    }
  };
