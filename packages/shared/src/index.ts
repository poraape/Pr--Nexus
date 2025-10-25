import { diag, trace, SpanStatusCode, Span } from '@opentelemetry/api';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogger {
  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

const log = (level: LogLevel, source: string, message: string, attributes?: Record<string, unknown>) => {
  const payload = { message, source, attributes, ts: new Date().toISOString() };
  switch (level) {
    case 'DEBUG':
      console.debug(payload);
      break;
    case 'INFO':
      console.info(payload);
      break;
    case 'WARN':
      console.warn(payload);
      break;
    case 'ERROR':
      console.error(payload);
      break;
  }
};

export const createLogger = (source: string): StructuredLogger => ({
  debug: (message, attributes) => log('DEBUG', source, message, attributes),
  info: (message, attributes) => log('INFO', source, message, attributes),
  warn: (message, attributes) => log('WARN', source, message, attributes),
  error: (message, attributes) => log('ERROR', source, message, attributes)
});

export interface TelemetryClient {
  startSpan<T>(name: string, fn: () => Promise<T>, attributes?: Record<string, unknown>): Promise<T>;
  recordException(error: unknown, attributes?: Record<string, unknown>): void;
  recordMetric(name: string, value: number, attributes?: Record<string, unknown>): void;
}

export const createTelemetry = (instrumentationName: string): TelemetryClient => {
  const tracer = trace.getTracer(instrumentationName);

  return {
    async startSpan<T>(name, fn, attributes) {
      const span = tracer.startSpan(name);
      if (attributes) {
        span.setAttributes(attributes);
      }
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'unknown error' });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    },
    recordException(error, attributes) {
      diag.error('Agent exception', { error, attributes });
    },
    recordMetric(name, value, attributes) {
      diag.info('Metric', { name, value, attributes });
    }
  };
};

export interface MemoryKvStore {
  get<TValue = unknown>(key: string): Promise<TValue | null>;
  put<TValue = unknown>(key: string, value: TValue, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export const createInMemoryKvStore = (): MemoryKvStore => {
  const store = new Map<string, { value: unknown; expiresAt?: number }>();

  return {
    async get(key) {
      const record = store.get(key);
      if (!record) return null;
      if (record.expiresAt && record.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return record.value as unknown;
    },
    async put(key, value, ttlSeconds) {
      store.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined
      });
    },
    async delete(key) {
      store.delete(key);
    }
  };
};

export interface Lock {
  key: string;
  expiresAt: number;
}

export const createInMemoryLockManager = () => {
  const locks = new Map<string, Lock>();

  const acquire = async (key: string, ttlSeconds: number) => {
    const now = Date.now();
    const existing = locks.get(key);
    if (existing && existing.expiresAt > now) {
      return false;
    }
    locks.set(key, { key, expiresAt: now + ttlSeconds * 1000 });
    return true;
  };

  const release = async (key: string) => {
    locks.delete(key);
  };

  return { acquire, release };
};
