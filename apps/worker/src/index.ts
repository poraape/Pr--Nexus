import {
  AssistantAgent,
  AuditorAgent,
  ClassifierAgent,
  IngestorAgent,
  LedgerAgent,
  ObservabilityAgent,
  OcrParserAgent,
  PlannerAgent,
  ReportingAgent,
  ReconciliationAgent
} from '@pr-nexus/agents';
import type { AgentDefinition, AgentInput } from '@pr-nexus/agents';
import {
  AnyEventMessage,
  EVENT_TOPIC,
  EventMessage,
  EventName,
  EventPayloadMap,
  Queue,
  QueueBindingKey,
  QueueBindings,
  QueueName,
  QUEUE_BINDING_BY_TOPIC,
  createEventMessage,
  isEventMessage
} from '@pr-nexus/contracts';
import { createLogger, createTelemetry } from '@pr-nexus/shared';
import { DocumentSchema } from '@pr-nexus/schemas';
import { z } from 'zod';

type Nullable<T> = T | null | undefined;

interface Env extends QueueBindings {
  KV_STATE: KVNamespace;
  KV_LOCKS: KVNamespace;
  D1_STATE: D1Database;
}

const ingestRequestSchema = z.object({
  tenantId: z.string().min(1),
  source: z.enum(['upload', 'api', 'backfill']).default('upload'),
  documents: z
    .array(
      z.object({
        name: z.string(),
        mimeType: z.string().min(1),
        sizeBytes: z.number().int().nonnegative(),
        checksum: z.string().optional(),
        storageUrl: z.string().url().optional(),
        tags: z.array(z.string()).optional()
      })
    )
    .min(1),
  options: z
    .object({
      priority: z.enum(['low', 'normal', 'high']).optional(),
      reprocess: z.boolean().optional(),
      dryRun: z.boolean().optional()
    })
    .optional()
});

const assistantRequestSchema = z.object({
  docId: z.string().min(1),
  query: z.string().min(1),
  scope: z.enum(['summary', 'ledger', 'tax', 'full']).default('full')
});

const agentRegistry: Partial<Record<EventName, AgentDefinition<any, any>>> = {
  'evt.pipeline.requested': PlannerAgent,
  'evt.doc.ingested': IngestorAgent,
  'evt.doc.parsed': OcrParserAgent,
  'evt.doc.normalized': AuditorAgent,
  'evt.audit.done': ClassifierAgent,
  'evt.classification.ready': LedgerAgent,
  'evt.tax.ready': ReconciliationAgent,
  'evt.recon.done': ReportingAgent,
  'evt.report.ready': AssistantAgent,
  'evt.assistant.ready': ObservabilityAgent
};

const detectKind = (mimeType: string): DocumentSchema['shape']['kind']['_def']['values'][number] => {
  if (mimeType.includes('json')) return 'CSV';
  if (mimeType.includes('csv')) return 'CSV';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'XLSX';
  if (mimeType.includes('xml')) return 'NFE_XML';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.startsWith('image/')) return 'IMAGE';
  return 'UNSUPPORTED';
};

const toDocument = (
  tenantId: string,
  source: 'upload' | 'api' | 'backfill',
  input: {
    name: string;
    mimeType: string;
    sizeBytes: number;
    checksum?: string;
    storageUrl?: string;
    tags?: string[];
  }
) => {
  const kind = detectKind(input.mimeType);
  const requiresOcr = kind === 'PDF' || kind === 'IMAGE';
  return DocumentSchema.parse({
    docId: crypto.randomUUID(),
    tenantId,
    source,
    kind,
    name: input.name,
    sizeBytes: input.sizeBytes,
    checksum: input.checksum,
    uploadedAt: new Date().toISOString(),
    status: requiresOcr ? 'ocr_needed' : 'parsed',
    storageUrl: input.storageUrl,
    meta: {
      tags: input.tags
    }
  });
};

const createKvAdapter = (namespace: KVNamespace) => ({
  async get<TValue = unknown>(key: string): Promise<TValue | null> {
    const value = await namespace.get<TValue>(key, 'json');
    return (value ?? null) as Nullable<TValue>;
  },
  async put<TValue = unknown>(key: string, value: TValue, ttlSeconds?: number) {
    await namespace.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
  },
  async delete(key: string) {
    await namespace.delete(key);
  }
});

const createLockAdapter = (namespace: KVNamespace) => ({
  async acquire(key: string, ttlSeconds: number) {
    const existing = await namespace.get(key);
    if (existing) return false;
    await namespace.put(key, Date.now().toString(), { expirationTtl: ttlSeconds });
    return true;
  },
  async release(key: string) {
    await namespace.delete(key);
  }
});

const getQueueBinding = (env: Env, queueName: QueueName) => {
  const bindingKey: QueueBindingKey = QUEUE_BINDING_BY_TOPIC[queueName];
  return env[bindingKey] as Queue;
};

const dispatchEvent = async (env: Env, event: AnyEventMessage) => {
  const queueName = EVENT_TOPIC[event.name];
  const queue = getQueueBinding(env, queueName);
  await queue.sendBatch([{ body: JSON.stringify(event) }]);
};

const runAgent = async (agent: AgentDefinition<any, any>, event: AnyEventMessage, env: Env, ctx: ExecutionContext) => {
  const logger = createLogger(agent.id);
  const telemetry = createTelemetry(`agent-${agent.id}`);
  const kvStore = createKvAdapter(env.KV_STATE);
  const lockManager = createLockAdapter(env.KV_LOCKS);

  const agentInput: AgentInput<any> = {
    traceId: event.headers.traceId,
    docId: event.headers.docId,
    payload: event.payload,
    ts: Date.parse(event.headers.timestamp),
    attempt: event.headers.attempt
  };

  const agentContext = {
    env,
    enqueue: (message: EventMessage<EventName>) => dispatchEvent(env, message),
    kv: kvStore,
    locks: lockManager,
    telemetry,
    logger
  };

  return telemetry.startSpan(`agent.${agent.id}`, () => agent.handle(agentInput, agentContext), {
    event: event.name
  });
};

const parseMessageBody = (body: unknown): AnyEventMessage | null => {
  if (!body) return null;
  if (typeof body === 'string') {
    return JSON.parse(body) as AnyEventMessage;
  }
  if (body instanceof ArrayBuffer) {
    const text = new TextDecoder().decode(body);
    return JSON.parse(text) as AnyEventMessage;
  }
  return body as AnyEventMessage;
};

const createQueueHandler = (queueName: QueueName) => ({
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
    for (const message of batch.messages) {
      try {
        const parsed = parseMessageBody(message.body);
        if (!parsed || !isEventMessage(parsed)) {
          continue;
        }
        const agent = agentRegistry[parsed.name];
        if (!agent) {
          continue;
        }
        await runAgent(agent, parsed, env, ctx);
      } catch (error) {
        console.error(`[queue:${queueName}] handler failed`, error);
        message.retry();
      }
    }
  }
});

const ingestQueue = createQueueHandler('q.ingest');
const parseQueue = createQueueHandler('q.parse');
const normalizeQueue = createQueueHandler('q.normalize');
const auditQueue = createQueueHandler('q.audit');
const classifyQueue = createQueueHandler('q.classify');
const ledgerQueue = createQueueHandler('q.ledger');
const taxQueue = createQueueHandler('q.tax');
const reconQueue = createQueueHandler('q.recon');
const reportQueue = createQueueHandler('q.report');
const observabilityQueue = createQueueHandler('q.observability');

const getJson = async <T>(request: Request, schema: z.ZodSchema<T>) => {
  const json = await request.json();
  return schema.parse(json);
};

const handleIngest = async (request: Request, env: Env) => {
  const payload = await getJson(request, ingestRequestSchema);
  const jobId = crypto.randomUUID();
  const documents = payload.documents.map((doc) => toDocument(payload.tenantId, payload.source, doc));

  const event = createEventMessage('evt.pipeline.requested', {
    traceId: jobId,
    docId: jobId,
    idempotencyKey: `${jobId}:pipeline`,
    attempt: 0,
    timestamp: new Date().toISOString()
  }, {
    traceId: jobId,
    tenantId: payload.tenantId,
    documents,
    options: payload.options ?? {}
  } as EventPayloadMap['evt.pipeline.requested']);

  await dispatchEvent(env, event);

  await env.KV_STATE.put(`job:${jobId}`, JSON.stringify({
    jobId,
    tenantId: payload.tenantId,
    status: 'scheduled',
    docIds: documents.map((doc) => doc.docId),
    createdAt: new Date().toISOString()
  }));

  return new Response(
    JSON.stringify({
      jobId,
      docIds: documents.map((doc) => doc.docId)
    }),
    {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    }
  );
};

const handleGetReport = async (docId: string, env: Env) => {
  const record = await env.KV_STATE.get(`report:${docId}`, 'json');
  if (!record) {
    return new Response(JSON.stringify({ message: 'Report not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify(record), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const handleAssistant = async (request: Request, env: Env) => {
  const payload = await getJson(request, assistantRequestSchema);
  const knowledge = await env.KV_STATE.get(`assistant:${payload.docId}`, 'json');
  const report = await env.KV_STATE.get(`report:${payload.docId}`, 'json');

  if (!report) {
    return new Response(JSON.stringify({ message: 'Report not ready' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(
    JSON.stringify({
      docId: payload.docId,
      scope: payload.scope,
      answer: 'Assistente ainda em implementacao. Consulte o relatorio para detalhes.',
      knowledge,
      reportSummary: {
        title: report.summary?.title,
        generatedAt: report.generatedAt
      }
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

const handleOptions = () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
  });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (request.method === 'POST' && pathname === '/api/ingest') {
        return await handleIngest(request, env);
      }

      if (request.method === 'GET' && pathname.startsWith('/api/reports/')) {
        const docId = pathname.replace('/api/reports/', '');
        return await handleGetReport(docId, env);
      }

      if (request.method === 'POST' && pathname === '/api/assistant') {
        return await handleAssistant(request, env);
      }

      return new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Worker fetch error', error);
      return new Response(JSON.stringify({ message: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
    // Unified queue consumer for all configured queues.
    for (const message of batch.messages) {
      try {
        const parsed = parseMessageBody(message.body);
        if (!parsed || !isEventMessage(parsed)) {
          continue;
        }
        const agent = agentRegistry[parsed.name];
        if (!agent) {
          continue;
        }
        await runAgent(agent, parsed, env, ctx);
      } catch (error) {
        console.error('[queue] handler failed', error);
        message.retry();
      }
    }
  }
};

// Named handlers remain exported in case future config supports per-binding routing.
export { ingestQueue, parseQueue, normalizeQueue, auditQueue, classifyQueue, ledgerQueue, taxQueue, reconQueue, reportQueue, observabilityQueue };
