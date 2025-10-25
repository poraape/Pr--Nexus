# Operations Runbook

## Local Development
- Install dependencies once `pnpm` is available: `pnpm install`.
- UI: `pnpm dev:web` (Vite dev server on port 3000).
- Worker: `pnpm dev:worker -- --env infra/wrangler.toml` (requires Cloudflare Wrangler authenticated).
- Tests (planned): `pnpm -r test`, `pnpm -r typecheck`.

## Deploy
1. Configure KV namespaces (`KV_STATE`, `KV_LOCKS`), D1 database, and queues defined in `infra/wrangler.toml`.
2. Set Wrangler secrets (`wrangler secret put GEMINI_API_KEY`, etc).
3. Deploy Worker: `pnpm --filter @pr-nexus/worker deploy --env production`.
4. Deploy Web (Vercel/Pages) pointing to `/api/*` Worker endpoints.
5. Update CI secrets with Cloudflare API token + Account ID.

## Monitoring & Alerting
- **Traces**: Export OpenTelemetry spans from agents (hook to Sentry/Logflare/Tempo).
- **Metrics**: `pipeline.finalized` counter emitted by ObservabilityAgent. Extend to queue depth/backlog.
- **Logs**: Worker logs forward to Sentry breadcrumb or Logflare sink. UI logs remain client-side until adapter introduced.
- **Health checks**: expose `/healthz` (TODO) returning KV + queue connectivity status.

## Failure Recovery
| Scenario | Detection | Resolution |
|----------|-----------|------------|
| Lock contention (doc already processing) | PlannerAgent increments `skipped` metric | Investigate `lock:doc:{docId}` expiry; manual `KV_LOCKS.delete`. |
| Idempotency replay (ingestion) | IngestorAgent logs `cached: true` | Safe – cached `ParsedDocument` reused. |
| Dead-letter (persistent failure) | Queue retries exhausted (Wrangler metrics) | Move message to DLQ (future binding) and create GitHub issue with traceId. |
| Missing report (`/api/reports` 404) | Report not persisted | Inspect KV `job:{traceId}` for `status`. Requeue from Planner with `reprocess=true`. |
| Assistant stale knowledge | `/api/assistant` returns generic text | Clear `assistant:{docId}` and re-trigger `evt.report.ready`. |

## Backfills & Reprocessing
- To reprocess documents, enqueue a manual `evt.pipeline.requested` with `options.reprocess=true`. Ensure locks cleared.
- For mass backfill, prefer Cloudflare Queues producers (Workers Cron or Durable Object) to avoid UI impact.

## Secrets & Config
- `GEMINI_API_KEY` (frontend for now, future Worker secret).
- `SENTRY_DSN`, `OTEL_EXPORTER_URL` (when observability sinks connected).
- `REPORT_BUCKET` (R2 bucket name) stored in Worker vars.

## Housekeeping
- Rotate KV records: current TTL 7 days for reports/knowledge; adjust in agents if retention changes.
- Queue concurrency: tune consumer concurrency per queue via Wrangler configuration once throughput known.
- CI/CD: forthcoming GitHub Actions pipeline will run codegen → test → deploy. Ensure minimum privileges for CF API token.
