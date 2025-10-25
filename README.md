# Pr-Nexus Monorepo

This repository hosts the refactored multi-agent backend plus the existing Nexus QuantumI2A2 UI.

## Packages & Apps
| Path | Description |
|------|-------------|
| `apps/web` | React/Tailwind frontend (UI contract frozen; see `docs/FRONTEND_CONTRACT.md`). |
| `apps/worker` | Cloudflare Worker orchestrating document pipelines, queues, KV/D1. |
| `packages/schemas` | Zod + JSON Schema definitions for documents, audits, ledger, tax, reconciliation. |
| `packages/contracts` | Event types, queue bindings, message helpers. |
| `packages/agents` | Agents A0–A10 (planner → observability). |
| `packages/shared` | Telemetry/logging/KV helpers shared across packages. |
| `docs` | Architecture, contracts, operations runbooks. |
| `infra` | Wrangler configuration and future infra as code. |

## Getting Started
1. Install dependencies (when pnpm is available): `pnpm install`.
2. Run UI: `pnpm dev:web`.
3. Run Worker: `pnpm dev:worker -- --env infra/wrangler.toml` (requires `wrangler` login).
4. Check docs in `docs/` for architecture and runbook details.

## Status
- Backend scaffolding (queues, agents, schemas) in place.
- Frontend still uses legacy in-browser pipeline; adapters to Worker APIs are next.
- CI/CD, automated tests, and production queue bindings tracked in follow-up tasks.
