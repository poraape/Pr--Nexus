# Contracts

## HTTP API
| Method | Path | Request Schema | Response |
|--------|------|----------------|----------|
| POST | `/api/ingest` | `{ tenantId, source, documents[{ name, mimeType, sizeBytes, checksum?, storageUrl?, tags? }], options? }` | `202 Accepted` – `{ jobId, docIds[] }` |
| GET | `/api/reports/:docId` | — | `200 OK` – serialized `AuditReport` (from `packages/schemas`) or `404` |
| POST | `/api/assistant` | `{ docId, query, scope }` | `200 OK` – `{ answer, knowledge, reportSummary }` or `404` |
| POST | `/api/assistant` (streaming LLM)* | _reserved_ | — |
`*` Chat streaming remains on the frontend using Gemini SDK until the Worker proxy is introduced.

### Request Validation
- All payloads run through Zod schemas defined in `packages/schemas`.
- Any validation failure returns `400` with the aggregated Zod error messages.

## Event Interfaces
| Event | Payload (see `packages/schemas`) | Headers |
|-------|----------------------------------|---------|
| `evt.pipeline.requested` | `{ traceId, tenantId, documents[], options }` | `{ traceId, docId(jobId), idempotencyKey, attempt, timestamp }` |
| `evt.doc.ingested` | `Document` | idem |
| `evt.doc.parsed` | `ParsedDocument` | idem |
| `evt.doc.normalized` | `NormalizedDocument` | idem |
| `evt.audit.done` | `{ audit: AuditReport }` | idem |
| `evt.classification.ready` | `{ audit, classification }` | idem |
| `evt.classification.needs_review` | `{ audit, docName }` (emitted on low confidence) | idem |
| `evt.ledger.ready` | `{ audit, ledgerEntries[] }` | idem |
| `evt.tax.ready` | `{ audit, taxApportion[] }` | idem |
| `evt.recon.done` | `{ audit, recon }` | idem |
| `evt.report.ready` | `{ audit }` | idem |
| `evt.assistant.ready` | `{ audit, knowledgeBase }` | idem |

Every event is built with `createEventMessage` ensuring versioning and header hygiene. Consumers must always validate payloads (`z.parse`) before processing.

## Queue Bindings
| Queue | Binding | Events In | Consumers |
|-------|---------|-----------|-----------|
| `pr-nexus-ingest` | `QUEUE_INGEST` | `evt.pipeline.requested` | PlannerAgent |
| `pr-nexus-parse` | `QUEUE_PARSE` | `evt.doc.ingested` | IngestorAgent |
| `pr-nexus-normalize` | `QUEUE_NORMALIZE` | `evt.doc.parsed` | OcrParserAgent (+ future NormalizerAgent) |
| `pr-nexus-audit` | `QUEUE_AUDIT` | `evt.doc.normalized` | AuditorAgent |
| `pr-nexus-classify` | `QUEUE_CLASSIFY` | `evt.audit.done` | ClassifierAgent |
| `pr-nexus-ledger` | `QUEUE_LEDGER` | `evt.classification.ready` | LedgerAgent |
| `pr-nexus-tax` | `QUEUE_TAX` | `evt.ledger.ready` & `evt.tax.ready` | LedgerAgent (producer), ReconciliationAgent (consumer) |
| `pr-nexus-recon` | `QUEUE_RECON` | `evt.tax.ready` | ReconciliationAgent |
| `pr-nexus-report` | `QUEUE_REPORT` | `evt.recon.done` | ReportingAgent |
| `pr-nexus-observability` | `QUEUE_OBSERVABILITY` | `evt.report.ready`, `evt.assistant.ready` | AssistantAgent, ObservabilityAgent |

## Storage Keys (KV)
- `job:{traceId}` – job envelope `{ status, docIds[], tenantId, createdAt, updatedAt }`.
- `report:{docId}` – final `AuditReport` serialised for GET `/api/reports`.
- `assistant:{docId}` – assistant knowledge base snapshot.
- `ingest:{docId}:{traceId}` – cached parsed document (ingestion idempotency).
- `lock:doc:{docId}` – transient lock to avoid double scheduling (Planner).

## Schema Versioning
- All Zod schemas live in `packages/schemas/src/index.ts`.
- JSON Schema exports (`JsonSchemaRegistry`) are ready for OpenAPI generation (TO DO in CI pipeline).
- Breaking changes: bump `version` field in event envelope and keep old branch alive during migration; UI adapters must handle both.
