# FaultPact RPC baseline and post-remediation evidence

**Capture date:** 2026-09-24 UTC  
**Scope:** FaultPact API/worker traffic to `https://studio-dev.genlayer.com/api` only.  
**Network:** GenLayer Studio Development Preview, chain `61997`.

## Source and rollback

- Editable Git source: `/root/faultpact`, `main`, HEAD `faa39c0bc9d270c3436b120d4d40d107f9dc8191`; existing uncommitted product work was preserved.
- Production deployment: `/opt/faultpact`, generated `dist`, no Git metadata.
- Pinned runtime: `/opt/faultpact-runtime/node`, Node `v22.23.2`, SHA-256 `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`.
- Pre-change snapshot: `/var/backups/faultpact/rpc-remediation-20260924T213250Z`.
- Protected current-deployment snapshots include `/var/backups/faultpact/rpc-remediation-current-20260924T215620Z`, `/var/backups/faultpact/rpc-remediation-final-predeploy-20260924T221238Z`, and `/var/backups/faultpact/rpc-remediation-close-predeploy-20260924T221932Z`.

## Before remediation

Observed worker configuration:

```text
INDEXER_POLL_INTERVAL_MS=30000
INDEXER_RECONCILE_INTERVAL_MS=60000
PROBE_INTERVAL_MS=30000
AUTO_ONCHAIN_SUBMISSION=false
```

The old worker ignored its persisted entity cursors and replayed IDs from `1` on every index cycle. With the captured projection, an available-RPC idle cycle was approximately 34 Studio calls. Reconciliation read terminal claims, and the Studio monitor used an independent client and ran every 30 seconds.

Bounded 24-hour journal window (`2026-09-23 21:55:34Z` onward):

```text
RPC/cooldown-related matches: 3,937
indexer-cycle failures:        1,582
reconciliation failures:       1,320
```

These are application events, not outbound request counts. The old transport had no `actuallySent` counter and rejected most repeated work locally after its process-local cooldown.

The production projection at capture contained:

```text
providers: 1
services: 1
pacts: 2
coverages: 3
incidents: 3
evidence: 7
claims: 3
```

All three coverages were `RELEASED`, all incidents `FINALIZED`, and claims were terminal (`2 INELIGIBLE`, `1 SETTLED`). The old idle code nevertheless attempted the full graph every cycle.

## Measured monitor lower bound

The corresponding 24-hour database window contained:

```text
probe runs:        2,757
successful probes: 2,753
failed probes:         4
```

`probeRpc()` performs exactly three Studio methods for a successful target (`eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`). Therefore the monitor path proves at least:

```text
2,753 x 3 = 8,259 successful Studio method calls
```

The four failed runs could account for zero to three requests each, so the monitor-only range is **8,259–8,271 requests**. This excludes indexer, reconciliation, API, deployment verification, retries, browser traffic, and non-Studio probes. The earlier full-day capture recorded 2,780 runs / 2,776 successes and an 8,328-call successful lower bound.

The old available-RPC static estimate was:

```text
indexer:        34 x 2,880 = 97,920 calls/day
reconcile:       3 x 1,440 =  4,320 calls/day
Studio monitor:  3 x 2,880 =  8,640 calls/day
worker total:                    110,880 calls/day
```

This is a code-and-row-count estimate, not a measurement. It excludes retries and API traffic.

## Post-remediation production evidence

The final close-fix deployment restarted the API at `2026-09-24T22:19:56Z` and the worker at `2026-09-24T22:20:01Z`; the web process was not restarted.

The completed one-time cursor repair is recorded in PostgreSQL:

```text
LEGACY_CURSOR_REPAIR_STARTED  2026-09-24 22:15:01.955 UTC
LEGACY_CURSOR_REPAIRED        2026-09-24 22:16:37.850 UTC
```

The worker metrics captured before the final restart show the repair window's 49 actual sends:

```text
deployment verification: 2
indexer repair:         34
reconciliation:         10
Studio monitor:          3
total:                  49
```

After the final restart, the shared scheduler metrics and API/worker status showed 16 actual sends during the startup window: two API deployment checks, two worker deployment checks, two indexer calls, and ten bounded reconciliation calls. The monitor sent zero calls in that startup window because its 30-minute cadence was not due.

A bounded natural observation was recorded at `/var/backups/faultpact/rpc-observation-20260924T222033Z`, with a second 34-sample capture at `/var/backups/faultpact/rpc-observation-20260924T222300Z`. The captures sample persisted scheduler state, service state, Studio-related sockets, and journals without deliberately contacting Studio. They show one additional counter-discovery send, no error-level rate-limit/cooldown burst, no lease left behind, and no service restart.

The persisted shared state at the final capture was:

```text
budget day: 2026-09-24
count:      107
ceiling:    1,400
lease:      none
cooldown:   expired
```

The count is a local UTC-day reservation count, not proof of the provider's remote quota consumption. A reservation can be made immediately before `fetch`; therefore the report uses the transport's `actuallySent` metric for actual outbound calls and treats the state count as a conservative shared-budget upper bound.

## Correctness and safety observations

- PostgreSQL projection counts remain `1 provider, 1 service, 2 pacts, 3 coverages, 3 incidents, 7 evidence, 3 claims`.
- All nine deployment cursors, including the separate reconciliation cursor, are `HEALTHY` with no `lastError`.
- API `/health` returned HTTP 200 with database/process `ok`; `/ready` returned HTTP 200 with indexed reads available.
- The frozen deployment remains chain `61997`, address `0xeb858957e3C426597245f6b59E260f1cC556Bf13`, source SHA-256 `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e`.
- `AUTO_ONCHAIN_SUBMISSION=false`; no state-changing transaction was sent.
- No migration command or PostgreSQL rollback was performed during this remediation. The database still contains the pre-existing failed `0003_evidence_status_and_claim_lookup` attempt from `2026-09-23` followed by its successful application; no new migration was introduced or run for the RPC fix.
- API, worker, and web services remained active with `NRestarts=0` at final verification; monitoring heartbeat continued.

## Evidence limitations

Journal log lines, TCP connection attempts, scheduler reservations, and function calls are not equivalent to outbound JSON-RPC requests. The pre-remediation transport did not expose an outbound counter. The final evidence therefore separates measured lower bounds, measured `actuallySent` counters, static estimates, and local deterministic tests rather than claiming an exact remote quota total. No additional direct Studio probe was sent solely to measure provider-side consumption.
