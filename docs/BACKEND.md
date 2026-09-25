# Backend

## Local setup

Requirements: Node.js 22, pnpm, PostgreSQL, and network access to Studio Dev.

```bash
pnpm install
pnpm db:generate
DATABASE_URL='postgresql://DB_HOST:5432/faultpact?schema=public' pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Copy `.env.example` to an environment-managed file and set `DATABASE_URL`.
The application rejects any chain, RPC, contract address, or source hash other
than the frozen Studio Dev values. Empty `REPORTER_PRIVATE_KEY` means
monitor-only mode and is valid.

## Processes

`apps/api` starts Fastify and exposes only read endpoints plus authenticated
internal monitoring-target management. `apps/worker` runs the onchain indexer,
reconciliation, probes, aggregation, candidate detection, and optional
artifact generation.

Root commands include `pnpm dev`, `pnpm start`, `pnpm schema:discover`,
`pnpm smoke:api`, and `pnpm smoke:worker`.

## API

Public routes are under `/api/v1`: network/config/status, bounded collection
routes for providers, services, pacts, coverages, incidents, evidence,
challenges, and claims, plus resource detail and incident subresources.

Operational routes are `/api/v1/health`, `/api/v1/ready`, `/api/v1/status`, and
`/api/docs`. Internal target mutation is disabled when `ADMIN_API_TOKEN` is
absent and otherwise requires `Authorization: Bearer ...`.

`/api/v1/ready` requires database connectivity and a previously verified
frozen deployment. A live startup check is used when available; an RPC cooldown
can start the API from the validated cached deployment and produce HTTP 200
with `degraded: true` while indexed reads remain available. Database loss or an
unverified deployment returns 503.

Responses identify indexed data and include freshness/source context where
applicable. Payouts and eligibility shown by the API are indexed contract
results, never backend decisions. No user wallet key is accepted by the API.
