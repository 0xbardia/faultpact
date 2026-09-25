# FaultPact Phase 4.2 Release Blocker Closure

Audit date: 2026-09-23. This is an in-progress closure record. **Release remains
blocked** until the web write flows, real browser-wallet writes, and live schema
certification pass.

## Confirmed fixes

| Symptom | Root cause | Fix | Verification |
| --- | --- | --- | --- |
| Public API returned 503 while indexed reads remained available during Studio 429 degradation. | `/api/v1/ready` combined database/deployment availability with external RPC and indexer freshness; a successful chain-id probe masked 429s from worker reads. | Readiness now requires database connectivity and startup-verified deployment; RPC and cursor freshness are reported separately. A 429 in the all-entity cursor marks `externalRpc` degraded even if `eth_chainId` responds. | API regression tests cover stale index, direct and indexer-reported RPC 429, database failure, and deployment verification. Live `/api/v1/ready` returned 200 with `ready: true`, `degraded: true`, `externalRpc: degraded`, `indexer: degraded`; health and indexed list/status endpoints returned 200. |
| PostgreSQL stopped during recovery and the live API returned database errors. | The host filesystem was effectively full; PostgreSQL logged a no-space PANIC while writing recovery/checkpoint files. | Reclaimed unreferenced pnpm package-store cache using pnpm’s prune command, preserved PostgreSQL files, reduced ext4 reserved blocks from 5% to 2%, and restarted PostgreSQL and the FaultPact units. | PostgreSQL reports online; API and worker are active; live health and indexed-list requests return 200. Filesystem reports about 1.1 GB available after the production build. |
| A fresh integration database failed with Prisma P3015 before tests ran. | An ignored, empty `prisma/migrations/0003_claim_incident_idx` directory had no `migration.sql`; Prisma treated it as a migration. | Removed the empty directory. Added `scripts/test-integration.mjs`, which selects a dedicated `_test` database, applies migrations, and runs the deterministic integration suite without requiring shell `DATABASE_URL`. | All three tracked migrations apply; `pnpm test:integration` passes with both `DATABASE_URL` and `TEST_DATABASE_URL` unset. `prisma migrate status` reports up to date. |

## RPC status

The frozen local schema remains available to the runtime. The explicit live
contract certification test received HTTP 429 with a `Retry-After` of about
13,924 seconds. This is recorded as **live certification unavailable**, not a
schema mismatch. The live test has been moved out of the deterministic test
suites to `tests/certification/contract-live.test.ts` and remains runnable with
`pnpm test:contract-live` when the quota permits.

## Checks completed so far

- Unit: 78 passed, 0 failed, 0 skipped.
- Deterministic integration: 1 passed, 0 failed, 0 skipped.
- Lint: pass.
- Typecheck: pass.
- Production build: pass (40 Next routes generated).
- Prisma validation: pass when pointed at the isolated test database.
- Migration status: 3 migrations found, no pending migrations.
- Live API readiness: pass with degraded indexer state reported accurately.
- Live browser smoke: homepage and Explorer loaded; 0 console errors/warnings.
- Contract source at audit start: SHA-256 matched the frozen value. It will be
  checked again before this phase is closed.

## Release blockers still open

- Provider registration, Service/Pact writes, Provider capital lifecycle,
  Claim filing, and credit withdrawal are still missing from the web console.
- No real Rabby/MetaMask transaction has been initiated through the live product
  UI in this phase; `E2E_TEST_PRIVATE_KEY` was absent.
- Live schema certification remains rate-limited.
- Full post-fix Playwright and wallet convergence checks remain pending.
- The Impeccable UI audit skill referenced by the workspace instructions is not
  installed in either configured skill root; clarification is pending before UI
  design/audit work proceeds.

No tag, GitHub Release, final commit, or final submission archive was created.
