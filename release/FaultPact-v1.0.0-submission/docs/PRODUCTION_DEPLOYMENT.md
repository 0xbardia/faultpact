# Production deployment

This runbook describes the deployed FaultPact application and a reproducible
upgrade path. It does not deploy or change the frozen contract.

## Fixed contract configuration

```text
GENLAYER_RPC_URL=https://studio-dev.genlayer.com/api
GENLAYER_CHAIN_ID=61997
FAULTPACT_CONTRACT_ADDRESS=0xeb858957e3C426597245f6b59E260f1cC556Bf13
FAULTPACT_SOURCE_SHA256=4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e
```

The source check must be performed before an application upgrade. A mismatch is
a deployment failure, not a reason to redeploy the contract.

## Requirements

- Node.js 22 and the checked-in pnpm version
- PostgreSQL 16 or a compatible managed PostgreSQL installation
- Nginx and a valid certificate for `faultpact.bydx.fun`
- access to the Studio Dev RPC
- a protected environment file; never commit it

The deployed host uses a dedicated `faultpact` service account, a systemd unit
for each API, worker, and web process, and host Nginx. Docker Compose in
`infra/docker/compose.yml` remains suitable for an isolated environment.

## Environment

Set the variables in `.env.example` plus deployment-specific values:

```text
NODE_ENV=production
DATABASE_URL=<protected PostgreSQL URL>
GENLAYER_RPC_URL=https://studio-dev.genlayer.com/api
GENLAYER_CHAIN_ID=61997
FAULTPACT_CONTRACT_ADDRESS=0xeb858957e3C426597245f6b59E260f1cC556Bf13
FAULTPACT_SOURCE_SHA256=4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e
API_HOST=127.0.0.1
API_PORT=4310
EVIDENCE_PUBLIC_BASE_URL=https://faultpact.bydx.fun/evidence
AUTO_ONCHAIN_SUBMISSION=false
MONITOR_MODE=observe
```

Quote a PostgreSQL URL containing `&` when exporting it in a shell. Systemd
`EnvironmentFile` loading is used by the deployed units. `REPORTER_PRIVATE_KEY`
is optional, environment-only, and must never be copied into the database or
logs.

## Build and migrate

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm db:validate
corepack pnpm db:migrate
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Use `prisma migrate deploy`, never `db push`, for a production database. The
original system certification recorded two migrations. The release candidate
adds `0003_evidence_status_and_claim_lookup`, which makes external-source
verification explicitly nullable and indexes Incident-filtered Claims. It was
applied to production on 2026-09-23; the migration status check reports no
pending migrations.

## Process topology

```text
Nginx :443
  ├── /       → Next.js web :4320
  ├── /api/   → Fastify API :4310
  └── /evidence/ → Fastify immutable artifact route :4310

PostgreSQL ← API and worker
Worker     → Studio Dev reads, reconciliation, monitoring
```

Start or restart only the intended units:

```bash
sudo systemctl restart faultpact-api
sudo systemctl restart faultpact-worker
sudo systemctl restart faultpact-web
sudo systemctl is-active faultpact-api faultpact-worker faultpact-web
```

Avoid running a second copy of the indexer against the same deployment unless a
coordination strategy is in place.

## Nginx and TLS

The site configuration must route `/`, `/api/`, and `/evidence/` to the services
above. Before every change:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

HTTP must redirect to HTTPS. Evidence responses must preserve exact stored bytes
and may be cached as public immutable content. API responses containing current
or user-specific state must not receive immutable caching.

Verify externally:

```bash
curl -I http://faultpact.bydx.fun/
curl -fsS https://faultpact.bydx.fun/
curl -fsS https://faultpact.bydx.fun/api/v1/health
curl -fsS https://faultpact.bydx.fun/api/v1/ready
```

DNS must resolve the intended host, and TLS must be checked with hostname
verification. Certificate renewal must be monitored by the host's existing
certificate tooling.

## Health checks

- `/api/v1/health` checks process, database, and configured contract.
- `/api/v1/ready` checks database, chain, deployment, and indexer freshness.
- `/api/v1/status` and worker heartbeat records provide operational detail.
- `/api/docs/json` exposes the generated API schema.

A healthy API does not prove a fresh schema request or a finalized user
transaction. Those are separate checks.

## Contract verification

The source file must remain unchanged:

```bash
sha256sum contracts/FaultPact.py
```

Expected result:

```text
4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e  contracts/FaultPact.py
```

Controlled live verification should call `eth_chainId`, deployed code, and the
schema endpoint with bounded retries. The schema is cached from the verified
snapshot at runtime; do not fetch it on every page request. A Studio Dev quota
response is a degraded verification result, never a PASS.

## Rollback

1. Keep the frozen contract and deployment manifest unchanged.
2. Stop or drain the web/API/worker units being changed.
3. Restore the previous application artifact and environment version.
4. Run health/readiness and a read-only indexer reconciliation.
5. Restore Nginx from its versioned backup only after `nginx -t` passes.
6. Roll back a database migration only with a reviewed down-migration or a
   database restore; never destroy indexed history casually.

The contract has no application rollback procedure. Application rollback must
continue to use the same chain, address, and source fingerprint.

## Backups and recovery

Back up PostgreSQL using standard PostgreSQL tooling and test restore access.
Preserve immutable evidence bytes and their SHA-256 values. If the database is
lost, bootstrap from current contract counters/views and restore monitoring data
from backups where available. RPC failures must not delete existing indexed
rows.

## Upgrade checklist

1. Review the diff and scan for secrets, old addresses, and localhost runtime
   references.
2. Verify the contract SHA and deployment manifest.
3. Run lint, typecheck, unit tests, integration tests, build, and migrations.
4. Deploy one application version at a time.
5. Verify `/health`, `/ready`, docs, explorer, and evidence byte hashes.
6. Inspect worker heartbeat and reconciliation logs.
7. Record the release commit and observed limitations.
