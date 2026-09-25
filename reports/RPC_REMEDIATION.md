# FaultPact Studio RPC quota remediation report

**Date:** 2026-09-24 UTC  
**Scope:** `/opt/faultpact` API and worker traffic to GenLayer Studio Development Preview (`chain 61997`).

## STATUS

**PARTIAL — the RPC remediation is deployed and production-verified; the remaining partial status is the repository-wide web production-build gate, not an RPC safety or correctness failure.**

The excessive request generation is fixed in production. The shared scheduler serialized the repair and steady-state work, the one-time cursor repair completed, the indexed projection stayed intact, and API/web availability was preserved. A full repository web build could not be certified: the package-manager build path attempts to purge the symlinked dependency tree without a TTY, and the direct Next build hits the pre-existing `<Html> should not be imported outside of pages/_document` / `404` and `/_error` prerender failure. The already-running web service remains active and was not restarted.

## ROOT CAUSE

The old worker persisted cursors but ignored them and replayed every entity from ID `1` on a 30-second loop. It also reconciled terminal claims every minute. The Studio monitor used a separate raw JSON-RPC client every 30 seconds, bypassing the worker transport, cooldown, and retry policy. Cooldown state was process-local, and API/worker startup verification had no cached-deployment fallback. These paths multiplied requests and generated repeated local cooldown/error churn.

The evidence separates log events, scheduler reservations, TCP observations, and actual outbound calls. The old transport did not have an `actuallySent` counter, so the before figures below are explicitly labeled as logs, lower bounds, or static estimates.

## BEFORE

- Old worker cadence: `INDEXER_POLL_INTERVAL_MS=30000`, `INDEXER_RECONCILE_INTERVAL_MS=60000`, `PROBE_INTERVAL_MS=30000`.
- 24-hour journal window: 3,937 RPC/cooldown-related matches, 1,582 indexer-cycle failures, and 1,320 reconciliation failures.
- 2,757 monitor runs, 2,753 successful; each successful Studio monitor run makes three methods, proving at least 8,259 successful Studio calls in that window (8,259–8,271 including failed-run uncertainty).
- Old available-RPC static estimate at the captured projection size: 34 calls per 30-second index cycle, approximately 110,880 worker calls/day before retries and request-driven API reads.
- The projection at capture was 1 provider, 1 service, 2 pacts, 3 coverages, 3 incidents, 7 evidence, and 3 claims; all coverage/incident/claim rows were terminal for routine reconciliation purposes.

## CHANGES

### Shared scheduler

- One `StudioRpcTransport` now serves worker, API, monitor, and operator paths that use the production Studio configuration.
- A file-backed state file coordinates API and worker with a UTC-day count, persisted cooldown, next allowed request, and expiring shared lease.
- Requests are serialized, minimum-spaced at 3,000 ms, deduplicated where appropriate, retried only for bounded temporary transport/5xx failures, and classified across HTTP 429, JSON-RPC rate limits, plain-text quota responses, `Retry-After`, hourly limits, and daily limits.
- Explicit server delays are never shortened. Corrupt state and stale locks fail closed/recover safely. The transport validates JSON-RPC envelopes, rejects redirects, allowlists read methods, supports abort/close, and emits attempted/sent/success/error/suppression metrics by method and subsystem.

### Indexer and reconciliation

- Persisted per-kind high-water cursors are authoritative for append indexing.
- The one-time legacy repair is durably marked started before resetting frontiers and repaired only after every entity kind succeeds. Partial failures retain the current ID.
- New-entity catch-up is contiguous and bounded by `INDEXER_MAX_ENTITY_BATCH=25`.
- Pact/incident child reads complete before terminal parent state is committed.
- Routine reconciliation is one globally bounded, oldest-first round-robin set of at most 10 current candidates. It filters terminal coverage/incidents/claims and retains mutable/unknown state.
- A separate durable `reconciliation` cursor and atomic anomaly audit make reconciliation health observable without a schema migration.

### Monitoring, API, and operations

- Studio monitor probes use the shared transport and a 30-minute target cadence; non-Studio monitoring retains its 30-second outer cadence.
- API and worker use the same scheduler state and can start from a previously verified frozen deployment when live verification is unavailable, while serving indexed data with degraded readiness rather than failing the whole service.
- Added scheduler metrics to `/api/v1/status`, graceful transport shutdown, and state-oriented cooldown logging.

Final production settings:

```text
INDEXER_POLL_INTERVAL_MS=300000
INDEXER_RECONCILE_INTERVAL_MS=1800000
INDEXER_RECONCILE_LIMIT=10
INDEXER_MAX_ENTITY_BATCH=25
GENLAYER_RPC_MIN_INTERVAL_MS=3000
GENLAYER_RPC_DAILY_BUDGET=1400
GENLAYER_RPC_MAX_RETRIES=2
GENLAYER_RPC_BUDGET_STATE_FILE=/opt/faultpact/.runtime/studio-rpc-scheduler.json
GENLAYER_RPC_METRICS_INTERVAL_MS=300000
GENLAYER_RPC_PROBE_INTERVAL_MS=1800000
PROBE_INTERVAL_MS=30000
AUTO_ONCHAIN_SUBMISSION=false
```

## AFTER

### Measured deployment activity

The final close-fix deployment restarted API at `22:19:56Z` and worker at `22:20:01Z`. The completed repair window recorded 49 actual successful worker sends:

```text
worker deployment verification:  2
one-time indexer repair:         34
bounded reconciliation:          10
Studio monitor:                   3
                                  --
total:                            49
```

After the final restart, the API recorded two successful deployment-verification sends and the worker recorded two deployment checks, two indexer calls, and ten bounded reconciliation calls. The final worker transport snapshot at the observation endpoint recorded 15 cumulative successful sends, all with zero 429, JSON-RPC rate-limit, 5xx, transport, or retry errors; the monitor sent zero calls in that post-restart window because its 30-minute cadence was not due.

### Bounded steady-state observation

The protected observation `/var/backups/faultpact/rpc-observation-20260924T222033Z` ran from approximately `22:20:33Z` through `22:26:34Z` without deliberately contacting Studio. A second 34-sample capture at `/var/backups/faultpact/rpc-observation-20260924T222300Z` ran from `22:23:20Z` through `22:28:55Z`; it saw the count remain 106 through `22:25:42Z`, change once to 107, and remain 107 thereafter. The final state was:

```text
shared budget count: 107 / 1,400
additional actual worker send: 1
API additional sends: 0
rate-limit/cooldown error burst: none
scheduler lease: none
cooldown: expired
```

The single additional call was the normal five-minute counter-discovery poll. The worker transport increased from 14 to 15 `actuallySent` calls during the window, while the API remained at two. The post-final worker journal contained zero error-level lines and no 429/rate-limit/5xx/transport/retry event. This is approximately 0.18 actual calls/minute during the bounded window; it is not an extrapolation of provider quota. The modeled normal steady-state cost is 960 worker calls/day, or 1,008/day including a worst-case API cache miss every 30 minutes, versus the old 110,880/day static estimate.

## CORRECTNESS

- PostgreSQL projection remains `1 provider, 1 service, 2 pacts, 3 coverages, 3 incidents, 7 evidence, 3 claims`.
- All nine cursor rows are `HEALTHY` with no error. The repair markers are present exactly once: `LEGACY_CURSOR_REPAIR_STARTED` and `LEGACY_CURSOR_REPAIRED`.
- The separate reconciliation cursor is healthy and last succeeded at `22:20:43.345Z`.
- API `/health` returned HTTP 200 with process/database `ok`; `/ready` returned HTTP 200 with indexed reads available. API `/stats` continued to serve the indexed projection.
- The worker heartbeat remained alive and reported no scheduler errors; Studio probe suppression during a non-due cadence is explicit, not a crash.
- The deployed chain, address, source fingerprint, and schema snapshot remain frozen and unchanged.
- Non-Studio monitoring remains on its original cadence; only Studio-dependent work shares the new scheduler.

## TESTS

Passed in the release validation tree:

- `vitest run`: **9 test files, 105/105 tests passed**.
- Backend TypeScript project build: `tsc -b` passed.
- Source web TypeScript check: `apps/web` `tsc --noEmit` passed. The isolated release copy's standalone web check was not counted because its symlinked staging `node_modules` did not expose React/Playwright declarations; this is a dependency-layout limitation, not an RPC test result.
- ESLint: `eslint . --max-warnings 0` passed.
- Prisma schema validation passed with the local validation URL; no migration command was run for this remediation. The production database retains the pre-existing failed `0003_evidence_status_and_claim_lookup` record from 2026-09-23 followed by its successful application; the RPC fix added no migration.
- Scheduler tests cover serialization, minimum spacing, deduplication, shared-process leases, 429/JSON-RPC/plain-text quota handling, `Retry-After`, daily budget, bounded retries, malformed envelopes, close/abort, stale locks, corrupt state, and restart behavior.
- Indexer tests cover one-time repair, idle immutability, cursor integrity, partial/child failures, incremental new entities, batch bounds, reconciliation filtering/fairness/mutability/health, and cooldown suppression.
- Monitor tests cover Studio rate-limit degradation, canonical Studio URL routing, scheduler-state failure, heartbeat continuity, and preserved non-Studio cadence.
- API tests cover health, cooldown availability, readiness degradation, stale-index detection, deployment verification, database boundaries, and indexed reads.
- The earlier isolated PostgreSQL integration/migration-state check also passed; production schema and migration state were not changed by the RPC work. The existing failed-then-successful `0003` history predates this remediation.

The full web production build remains the only uncaptured gate. The direct Next build reports the pre-existing document-import error and prerender failures for `/404` and `/_error`; the running production web process itself returned HTTP 200 and was left untouched.

## PRODUCTION

Final service state:

```text
faultpact-api    active/running  MainPID=1375797  NRestarts=0
faultpact-worker active/running  MainPID=1375836  NRestarts=0
faultpact-web    active/running  MainPID=1207229  NRestarts=0
```

Final local checks:

```text
API /health                 HTTP 200; database/process ok
API /ready                  HTTP 200; ready=true; indexed projection available
API /stats                  HTTP 200; indexed projection counts unchanged
web / and /app              HTTP 200
scheduler state             mode 0600, owned by faultpact
active scheduler lease      none
```

The production state file is restart-aware and must not be deleted or hand-edited. The final API and worker artifacts are generated from the reviewed release source; the web service was not restarted.

## SAFETY

- Contract source changed: **no**.
- Contract redeployed or address changed: **no**.
- GenLayer state-changing transaction sent: **no**.
- Wallet/protocol semantics changed: **no**.
- PostgreSQL schema or migrations changed/run: **no for this remediation**. A pre-existing failed `0003` migration record from 2026-09-23 remains in the database alongside its successful application; it was not created or altered here.
- Production environment committed: **no**.
- Other projects touched: **no**.
- Web service restarted: **no**.
- No intentional hosted-RPC hammering was used for measurement; no direct Studio probe was sent solely to establish an exact remote quota number.

Protected rollback snapshots:

```text
/var/backups/faultpact/rpc-remediation-20260924T213250Z
/var/backups/faultpact/rpc-remediation-current-20260924T215620Z
/var/backups/faultpact/rpc-remediation-final-predeploy-20260924T221238Z
/var/backups/faultpact/rpc-remediation-close-predeploy-20260924T221932Z
```

## ARTIFACTS

Production reports:

```text
/opt/faultpact/reports/RPC_ROOT_CAUSE.md
/opt/faultpact/reports/RPC_BASELINE_EVIDENCE.md
/opt/faultpact/reports/RPC_BUDGET.md
/opt/faultpact/reports/RPC_REMEDIATION.md
```

Release/source reports and evidence:

```text
/root/faultpact-rpc-release/reports/
/root/faultpact/reports/
/var/backups/faultpact/rpc-observation-20260924T222033Z
/var/backups/faultpact/rpc-observation-20260924T222300Z
```

The editable checkout remains on `main` at `faa39c0bc9d270c3436b120d4d40d107f9dc8191` with pre-existing uncommitted work preserved. No commit or push was made.

## FINAL VERDICT

**PARTIAL.** The RPC remediation itself is **PASS**: the root cause is fixed, the one-time repair completed, actual Studio sends are bounded and observable, the local budget has substantial headroom, all cursor/projection correctness checks pass, and API/worker/web remain available without transactions or schema changes. Overall repository delivery remains **PARTIAL solely because the full web production build cannot pass the pre-existing Next document/prerender gate; this does not block or reverse the verified production RPC fix.**
