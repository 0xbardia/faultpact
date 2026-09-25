# FaultPact Studio RPC root-cause analysis

**Capture date:** 2026-09-24 UTC  
**Network:** GenLayer Studio Development Preview, chain `61997`  
**Endpoint:** `https://studio-dev.genlayer.com/api`

## Authoritative source and rollback

- The version-controlled FaultPact source is the Git checkout at `/root/faultpact`, branch `main`, HEAD `faa39c0bc9d270c3436b120d4d40d107f9dc8191`, with pre-existing uncommitted product work preserved.
- The production deployment copy is `/opt/faultpact`; it is not a Git checkout and is launched from generated `dist` files by systemd.
- The remediation was developed and tested in the isolated copy `/root/faultpact-rpc-remediation` so concurrent pre-existing work in `/root/faultpact` was not overwritten. The final release is built from the current production tree with only the reviewed RPC/indexer/API scheduler files overlaid.
- Pre-change and current-deployment rollback snapshots are outside the repository under `/var/backups/faultpact/`, mode `0700`. The current-deployment snapshot includes source, generated artifacts, the protected environment, systemd unit copies, scheduler state, and hashes.
- `/opt/faultpact-runtime/node` is a pinned Node runtime only; no application source is stored there.

The frozen contract source, address, deployment, database schema, and chain state were not changed.

## Production evidence before the first scheduler deployment

The old worker was configured with:

```text
INDEXER_POLL_INTERVAL_MS=30000
INDEXER_RECONCILE_INTERVAL_MS=60000
PROBE_INTERVAL_MS=30000
```

The old source and generated worker repeatedly walked all entity IDs from `1`, despite persisting per-kind cursors. With the persisted projection counts, an available-RPC idle cycle made approximately 34 `gen_call` requests: 20 entity reads, 12 mutable child/projection reads, and counters/configuration. The old monitor target `studio-dev-smoke` pointed directly at Studio and used an independent client.

A bounded 24-hour journal query captured:

```text
RPC/cooldown-related matches: 3,937
indexer-cycle failures:        1,582
reconciliation failures:       1,320
```

These are application events, not outbound request counts. The old transport had no outbound counter. The database recorded 2,757 monitor runs in the corresponding 24-hour window, 2,753 successful; each successful `probeRpc` performs three Studio methods. Therefore the monitor path proves at least 8,259 successful Studio method calls in that window, with up to 12 additional attempts possible for the four failed runs. The earlier full-day snapshot recorded 2,780 runs and 2,776 successes (8,328 successful monitor method calls); both are lower bounds, not total FaultPact usage.

A protected pre-remediation syscall capture observed Studio/Cloudflare TCP connection attempts while the old worker was logging local cooldown rejections. TCP connections are not treated as JSON-RPC requests.

## Call graph and classification

| Subsystem | Trigger and cadence | Outbound RPC methods | Calls per invocation | Mutable/immutable behavior before fix | Shared cooldown before fix |
| --- | --- | --- | ---: | --- | --- |
| Indexer counters | `syncOnce()` every 30s | `gen_call(get_counters)` | 1 | Mutable discovery high-water mark | Transport-local only |
| Indexer configuration | Every old cycle | `gen_call(get_protocol_config)` | 1 | Mutable governance/configuration | Transport-local only |
| Entity catch-up | Every old cycle, IDs `1..counter-1` for seven kinds | `gen_call(get_<entity>)` | 20 at captured counts | Re-read finalized and mutable rows | No scheduler pause |
| Provider projection | Per provider | `gen_call(get_provider_vault)`, `gen_call(get_provider_stats)` | 2/provider | Mutable indefinitely | No scheduler pause |
| Pact projection | Per pact | `gen_call(get_pact_terms)`, `gen_call(get_pact_capacity)` | 2/pact | Status/capacity mutable; terms become frozen at publish | No scheduler pause |
| Incident projection | Per incident | `gen_call(get_incident_resolution)`, `gen_call(get_challenge)` | 1–2/incident | Mutable until `FINALIZED`; resolution/challenge can change before finality | No scheduler pause |
| Reconciliation | Every 60s | `gen_call(get_claim)` | 1/claim, up to 1,000 | Read all claims, including terminal | Separate loop; local rejections repeated |
| Studio monitor | Every 30s target cycle | `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber` | 3/successful target | Operational health signal | Independent `JsonRpcClient`; bypassed transport |
| Non-Studio monitor | Target cadence | Same three methods at the configured non-Studio endpoint | 3/successful target | Required infrastructure monitoring | Intentionally remains independent |
| Deployment verification | API/worker startup | `eth_chainId`, `gen_getContractCode` | 2 | Startup integrity check | Old API had no cached fallback; restart storm risk |
| API health/config/credits | Request-driven | `eth_chainId` or `gen_call` | 1 per cache miss/read | Live read; API data remains DB-backed | Same transport only after remediation |
| Explicit schema discovery | Operator/certification command | `gen_getContractSchema` in addition to startup checks | 1 extra | Explicit operation, not idle loop | Shared scheduler where configured |

No application runtime call site uses `genlayer-js.createClient`; the only `genlayer-js` runtime use is account construction. Browser wallet calls are user-initiated client traffic, not server-side worker/API traffic, and are outside this server scheduler.

## Root causes

1. **Primary:** the worker persisted cursors but ignored them and replayed the full entity graph every 30 seconds. Projection amplification made one nominal idle cycle exceed the hosted read budget.
2. **Major bypass:** the Studio monitor target used a separate raw JSON-RPC client with no shared cooldown, budget, retry policy, or request deduplication.
3. **Scheduler fragmentation:** API, worker, monitor, scripts, and browser paths did not share one server-side scheduling/budget layer.
4. **Restart amplification:** deployment verification ran before the worker/API could use cached verified deployment state, so a quota-blocked restart could create repeated startup attempts.
5. **Incomplete quota classification:** the old transport handled only HTTP 429; JSON-RPC quota errors and plain-text hosted quota responses were not consistently classified.
6. **Cadence/cost mismatch:** terminal rows and mutable projections were refreshed at the same aggressive cadence, with no bounded batch or state-aware reconciliation.

## Contract-state cutoffs used

The actual `contracts/FaultPact.py` state machine was used rather than guessed names:

- Provider: mutable indefinitely (metadata, ownership, vault, statistics).
- Service: status can retire, but metadata can still be updated; retained in bounded reconciliation.
- Pact: status/capacity remain mutable; terms are frozen at publish; retained in bounded reconciliation.
- Coverage: routine reconciliation stops only at `RELEASED`.
- Incident/resolution/challenge: routine reconciliation stops only at `FINALIZED`.
- Claim: routine reconciliation stops at `SETTLED` or `INELIGIBLE`.
- Evidence: chain metadata is immutable; indexed once and not reread by routine reconciliation. Local validation fields remain `NOT_CHECKED`/`NULL` until owned by a local validator.

## Remediation design

- One `StudioRpcTransport` now provides per-process serialization/deduplication plus a file-backed lease shared by the API and worker. It enforces configurable minimum spacing, bounded temporary retries, `Retry-After`, JSON-RPC and HTTP quota classification, persistent cooldown, and a daily local ceiling.
- The indexer uses persisted per-kind cursors for new top-level IDs, a durable one-time legacy-cursor repair marker, a configurable per-cycle batch limit, and contiguous-prefix advancement only after a complete projection succeeds.
- Reconciliation is bounded, round-robin, state-aware, and separate from append catch-up. It prioritizes mutable/nonterminal state; terminal rows are available through the explicit rare `reconcileFull()` audit path and cached API projections.
- The worker checks the shared cooldown before chain-dependent jobs and sleeps until `T + safety margin`; it does not wake every 30 seconds to re-run rejected jobs.
- Studio monitor probes use the shared transport and a 30-minute minimum cadence. Non-Studio infrastructure probes retain their configured cadence.
- API and worker pass the same scheduler state path. API/worker startup can use a previously verified frozen deployment during RPC unavailability, while the scheduler fails closed for new chain requests.
- State-change-oriented logs and RPC metrics expose attempted, actually-sent, successful, HTTP 429, JSON-RPC rate-limit, retry, local suppression, cooldown rejection, budget rejection, and per-method/per-subsystem counters. Request bodies and secrets are not logged.

## Exceptions and boundaries

- `JsonRpcClient` remains for non-Studio monitored endpoints; those probes do not consume Studio quota.
- Explicit live contract/schema certification commands remain operator-initiated and use the shared transport when launched with the production scheduler settings.
- No contract, deployment address, transaction, wallet, protocol semantic, Prisma schema, or unrelated project was changed.

## Final production confirmation

The final close-fix deployment restarted API and worker only. The one-time repair completed at `2026-09-24T22:16:37.850Z`; the final worker then remained active with `NRestarts=0`. The worker's transport metrics recorded 49 actual sends during the repair/startup window and 15 cumulative sends by the bounded observation endpoint, all successful, with no HTTP 429, JSON-RPC rate-limit, 5xx, transport, or retry errors. The API recorded two successful deployment-verification sends and remained available from its cached verified deployment.

The persisted shared budget count was 107 of 1,400 at the observation endpoint, with no active lease and an expired cooldown. The API/worker status and all nine cursor rows were healthy, and the indexed projection remained `1 provider, 1 service, 2 pacts, 3 coverages, 3 incidents, 7 evidence, 3 claims`. These observations confirm that the original full-replay and independent-monitor causes no longer generate the old request pattern; they do not claim an exact provider-side quota total.
