import { z } from 'zod';
import {
  AuditReportSchema,
  ClassificationSchema,
  DocumentSchema,
  LedgerEntrySchema,
  NormalizedDocumentSchema,
  ParsedDocumentSchema,
  ReconReportSchema,
  TaxApportionSchema
} from '@pr-nexus/schemas';

export interface Queue<T = unknown> {
  sendBatch(messages: T[]): Promise<void>;
}

export type EventName =
  | 'evt.pipeline.requested'
  | 'evt.doc.ingested'
  | 'evt.doc.parsed'
  | 'evt.doc.normalized'
  | 'evt.audit.done'
  | 'evt.classification.ready'
  | 'evt.classification.needs_review'
  | 'evt.ledger.ready'
  | 'evt.tax.ready'
  | 'evt.recon.done'
  | 'evt.report.ready'
  | 'evt.assistant.ready';

export type QueueName =
  | 'q.ingest'
  | 'q.parse'
  | 'q.normalize'
  | 'q.audit'
  | 'q.classify'
  | 'q.ledger'
  | 'q.tax'
  | 'q.recon'
  | 'q.report'
  | 'q.observability';

export const EVENT_TOPIC: Record<EventName, QueueName> = {
  'evt.pipeline.requested': 'q.ingest',
  'evt.doc.ingested': 'q.parse',
  'evt.doc.parsed': 'q.normalize',
  'evt.doc.normalized': 'q.audit',
  'evt.audit.done': 'q.classify',
  'evt.classification.ready': 'q.ledger',
  'evt.classification.needs_review': 'q.report',
  'evt.ledger.ready': 'q.tax',
  'evt.tax.ready': 'q.recon',
  'evt.recon.done': 'q.report',
  'evt.report.ready': 'q.observability',
  'evt.assistant.ready': 'q.observability'
};

export const EventHeaderSchema = z.object({
  traceId: z.string().min(1),
  docId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true })
});

export type EventHeaders = z.infer<typeof EventHeaderSchema>;

export interface EventPayloadMap {
  'evt.pipeline.requested': {
    traceId: string;
    tenantId: string;
    documents: z.infer<typeof DocumentSchema>[];
    options?: {
      priority?: 'low' | 'normal' | 'high';
      reprocess?: boolean;
      dryRun?: boolean;
    };
  };
  'evt.doc.ingested': z.infer<typeof DocumentSchema>;
  'evt.doc.parsed': z.infer<typeof ParsedDocumentSchema>;
  'evt.doc.normalized': z.infer<typeof NormalizedDocumentSchema>;
  'evt.audit.done': {
    audit: z.infer<typeof AuditReportSchema>;
  };
  'evt.classification.ready': {
    audit: z.infer<typeof AuditReportSchema>;
    classification: z.infer<typeof ClassificationSchema>;
  };
  'evt.classification.needs_review': {
    audit: z.infer<typeof AuditReportSchema>;
    docName: string;
  };
  'evt.ledger.ready': {
    audit: z.infer<typeof AuditReportSchema>;
    ledgerEntries: z.infer<typeof LedgerEntrySchema>[];
  };
  'evt.tax.ready': {
    audit: z.infer<typeof AuditReportSchema>;
    taxApportion: z.infer<typeof TaxApportionSchema>[];
  };
  'evt.recon.done': {
    audit: z.infer<typeof AuditReportSchema>;
    recon: z.infer<typeof ReconReportSchema>;
  };
  'evt.report.ready': {
    audit: z.infer<typeof AuditReportSchema>;
  };
  'evt.assistant.ready': {
    audit: z.infer<typeof AuditReportSchema>;
    knowledgeBase: {
      docId: string;
      embeddingsVersion: string;
      preparedAt: string;
    };
  };
}

export type EventMessage<Name extends EventName> = {
  name: Name;
  headers: EventHeaders;
  payload: EventPayloadMap[Name];
  version: number;
};

export type AnyEventMessage = {
  [Name in EventName]: EventMessage<Name>;
}[EventName];

export const createEventMessage = <Name extends EventName>(
  name: Name,
  headers: EventHeaders,
  payload: EventPayloadMap[Name],
  version = 1
): EventMessage<Name> => ({
  name,
  headers,
  payload,
  version
});

export const isEventMessage = (value: unknown): value is AnyEventMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AnyEventMessage>;
  return (
    typeof candidate.name === 'string' &&
    candidate.name in EVENT_TOPIC &&
    typeof candidate.headers === 'object' &&
    candidate.headers !== null &&
    typeof (candidate.headers as EventHeaders).traceId === 'string'
  );
};

export type QueueDispatch<Name extends EventName> = (message: EventMessage<Name>) => Promise<void>;

export interface QueueBindings {
  QUEUE_INGEST: Queue<unknown>;
  QUEUE_PARSE: Queue<unknown>;
  QUEUE_NORMALIZE: Queue<unknown>;
  QUEUE_AUDIT: Queue<unknown>;
  QUEUE_CLASSIFY: Queue<unknown>;
  QUEUE_LEDGER: Queue<unknown>;
  QUEUE_TAX: Queue<unknown>;
  QUEUE_RECON: Queue<unknown>;
  QUEUE_REPORT: Queue<unknown>;
  QUEUE_OBSERVABILITY: Queue<unknown>;
}

export type QueueBindingKey = keyof QueueBindings;

export const QUEUE_BINDING_BY_TOPIC: Record<QueueName, QueueBindingKey> = {
  'q.ingest': 'QUEUE_INGEST',
  'q.parse': 'QUEUE_PARSE',
  'q.normalize': 'QUEUE_NORMALIZE',
  'q.audit': 'QUEUE_AUDIT',
  'q.classify': 'QUEUE_CLASSIFY',
  'q.ledger': 'QUEUE_LEDGER',
  'q.tax': 'QUEUE_TAX',
  'q.recon': 'QUEUE_RECON',
  'q.report': 'QUEUE_REPORT',
  'q.observability': 'QUEUE_OBSERVABILITY'
};
