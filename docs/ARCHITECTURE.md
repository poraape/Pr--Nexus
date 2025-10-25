# Nexus MAS Architecture

## Monorepo Layout
- `apps/web` – React/Tailwind UI preserved from legacy build. Communicates through adapters that call the Worker API.
- `apps/worker` – Cloudflare Worker that exposes HTTP endpoints and consumes queue events to drive the multi-agent pipeline.
- `packages/schemas` – Zod schemas + JSON Schema generation for every artefact (documents, audits, ledger, tax, reconciliation).
- `packages/contracts` – Event names, headers, queue bindings, and helper factories for typed messages.
- `packages/agents` – Stateless agent implementations (A0–A10) following the shared `AgentDefinition` contract.
- `packages/shared` – Telemetry/logging primitives plus in-memory KV/lock helpers for local tests.
- `infra` – Deployment descriptors (`wrangler.toml`, future Terraform/CDKTF).
- `docs` – Frozen UI contract and operational documentation.

## Runtime Topology
```
Browser (apps/web) ─┬─► Cloudflare Worker (/api/ingest | /api/reports | /api/assistant)
                    └─► Cloudflare Queues (per stage)
                          ├─ KV_STATE (job + artefacts)
                          ├─ KV_LOCKS (idempotency + distributed locks)
                          └─ D1_STATE (reserved for persisted job timelines)
```
- **HTTP ingress**: requests hit the Worker, validated with Zod, persisted, and turned into `evt.pipeline.requested` messages.
- **Queues**: each stage uses a dedicated queue (`pr-nexus-*`) to fan out work and isolate retries.
- **KV/D1**: KV stores hot state (jobs, reports, assistant cache). D1 will track audit trails and reconciliation history.
- **Observability**: Every agent receives a telemetry/logger facade (OpenTelemetry API + console). Traces are generated per event hop.

## Event Pipeline
| Stage | Agent | Consumes | Produces | Queue | Responsibilities |
|-------|-------|----------|----------|-------|------------------|
| A0 | PlannerAgent | `evt.pipeline.requested` | `evt.doc.ingested` | `q.ingest` | Lock per `docId`, enqueue downstream ingestion work. |
| A1 | IngestorAgent | `evt.doc.ingested` | `evt.doc.parsed` | `q.parse` | Load raw payload metadata, persist idempotent parsed artefact. |
| A2 | OcrParserAgent | `evt.doc.parsed` | `evt.doc.normalized` | `q.normalize` | Apply OCR/Parser heuristics, emit structured rows. |
| A3 | NormalizerAgent* | `evt.doc.parsed` | `evt.doc.normalized` | `q.normalize` | Reserved for advanced normalization (placeholder stub). |
| A4 | AuditorAgent | `evt.doc.normalized` | `evt.audit.done` | `q.audit` | Build baseline `AuditReport` with metrics/inconsistency shells. |
| A5 | ClassifierAgent | `evt.audit.done` | `evt.classification.ready` | `q.classify` | Derive deterministic classification & confidence scores. |
| A6 | LedgerAgent | `evt.classification.ready` | `evt.ledger.ready`, `evt.tax.ready` | `q.ledger` / `q.tax` | Produce ledger entries + tax apportion skeletons. |
| A7 | ReconciliationAgent | `evt.tax.ready` | `evt.recon.done` | `q.recon` | Build reconciliation summary with compliance flags. |
| A8 | ReportingAgent | `evt.recon.done` | `evt.report.ready` | `q.report` | Persist final report, update job status, trigger publishing. |
| A9 | AssistantAgent | `evt.report.ready` | `evt.assistant.ready` | `q.observability` | Prepare chat knowledge base snapshot in KV. |
| A10 | ObservabilityAgent | `evt.assistant.ready` | — | `q.observability` | Emit metrics/traces and final log breadcrumbs. |
`*`A3 currently ships as a stub to keep contract parity; advanced normalization logic will plug here.

## Data Contracts
- All documents conform to `DocumentSchema` (`docId`, `tenantId`, `kind`, `status`, data/text fields).
- Runtime payloads are validated on ingress and before emitting every event (`z.parse` + JSON Schema export for OpenAPI).
- Reports, ledger entries, tax apportionment and recon artefacts inherit directly from shared schemas, guaranteeing the UI receives the exact shape defined in `docs/FRONTEND_CONTRACT.md`.

## Observability & Resilience
- Agent context surfaces `telemetry.startSpan`, `recordMetric`, and structured logger to ensure each hop is traced with `traceId/docId` baggage.
- Locks & idempotency rely on KV (60s TTL by default); storing processed artefacts avoids duplicate cost on retries.
- Queue backpressure is handled per queue (separate bindings allow tuning concurrency independently).

## Extensibility Checklist
- Add new agent: implement `packages/agents/src/ax-*/index.ts`, declare event in `packages/contracts`, bind queue in `infra/wrangler.toml`, register in Worker `agentRegistry`.
- Persist artefacts: use `context.kv` or `env.D1_STATE` within agent—never mutate shared state directly.
- Frontend adapters should target Worker endpoints only; breaking changes must be hidden behind adapters to protect the frozen UI contract.
