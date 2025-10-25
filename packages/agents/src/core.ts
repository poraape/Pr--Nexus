import type { AnyEventMessage, EventMessage, EventName } from '@pr-nexus/contracts';

export type AgentIdentifier =
  | 'A0'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'A7'
  | 'A8'
  | 'A9'
  | 'A10';

export interface AgentMetrics {
  durationMs: number;
  attempts: number;
  annotations?: Record<string, unknown>;
}

export interface AgentInput<TPayload = unknown> {
  traceId: string;
  docId: string;
  payload: TPayload;
  ts: number;
  attempt: number;
}

export interface AgentOutput<TResult = unknown> {
  traceId: string;
  docId: string;
  result: TResult;
  metrics: AgentMetrics;
  followUp?: AnyEventMessage[];
}

export interface LockManager {
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface KvStore {
  get<TValue = unknown>(key: string): Promise<TValue | null>;
  put<TValue = unknown>(key: string, value: TValue, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Telemetry {
  startSpan<T>(name: string, fn: () => Promise<T>, attributes?: Record<string, unknown>): Promise<T>;
  recordException(error: Error | unknown, attributes?: Record<string, unknown>): void;
  recordMetric(name: string, value: number, attributes?: Record<string, unknown>): void;
}

export interface AgentContext<Env = unknown> {
  env: Env;
  enqueue<Name extends EventName>(event: EventMessage<Name>): Promise<void>;
  kv: KvStore;
  locks: LockManager;
  telemetry: Telemetry;
  logger: {
    debug(message: string, attributes?: Record<string, unknown>): void;
    info(message: string, attributes?: Record<string, unknown>): void;
    warn(message: string, attributes?: Record<string, unknown>): void;
    error(message: string, attributes?: Record<string, unknown>): void;
  };
}

export type AgentHandler<TPayload, TResult, Env = unknown> = (
  input: AgentInput<TPayload>,
  context: AgentContext<Env>
) => Promise<AgentOutput<TResult>>;

export interface AgentDefinition<TPayload, TResult, Env = unknown> {
  id: AgentIdentifier;
  consumes: EventName;
  produces: EventName | EventName[];
  handle: AgentHandler<TPayload, TResult, Env>;
  timeoutMs?: number;
  maxAttempts?: number;
  dlqEvent?: EventName;
}
