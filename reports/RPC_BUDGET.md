# FaultPact Studio RPC daily budget model

**Date:** 2026-09-24 UTC

This is a static model unless explicitly labeled measured. The local ceiling is a FaultPact safety guard; it is **not** presented as GenLayer's true remote quota.

## Inputs

```text
INDEXER_POLL_INTERVAL_MS=300000             (5 minutes)
INDEXER_RECONCILE_INTERVAL_MS=1800000       (30 minutes)
INDEXER_RECONCILE_LIMIT=10
INDEXER_MAX_ENTITY_BATCH=25                 (new top-level IDs per kind/cycle)
GENLAYER_RPC_PROBE_INTERVAL_MS=1800000      (Studio monitor target)
GENLAYER_RPC_MIN_INTERVAL_MS=3000
GENLAYER_RPC_DAILY_BUDGET=1400
GENLAYER_RPC_MAX_RETRIES=2                  (temporary transport/5xx only)
PROBE_INTERVAL_MS=30000                    (non-Studio monitoring preserved)
```

Captured projection state used for the estimate:

```text
provider=1, service=1, pact=2, coverage=3,
incident=3, evidence=7, claim=3
coverage statuses: all RELEASED
incident statuses: all FINALIZED
claim statuses: all SETTLED/INELIGIBLE
```

## Before remediation

The old successful idle path attempted:

```text
2                         counters + protocol config
20                        seven top-level entity reads
2                         provider vault/stats views
4                         two pact terms/capacity pairs
6                         three incident resolution/challenge pairs
--
34                        Studio calls per 30-second cycle
```

At the old cadence:

```text
indexer:       34 x 2,880 = 97,920 calls/day
reconcile:      3 x 1,440 =  4,320 calls/day
Studio monitor: 3 x 2,880 =  8,640 calls/day
worker total:                    110,880 calls/day
```

Retries and API request-driven reads are additional. The old code did not have an outbound counter, so this is not an exact measured total. The measured monitor lower bound is recorded separately in `RPC_BASELINE_EVIDENCE.md`.

## After remediation

### Per-cycle costs

| Subsystem | Calls/cycle | Cycles/day | Calls/day |
| --- | ---: | ---: | ---: |
| Counter discovery | 1 | 288 | 288 |
| Protocol configuration refresh | 1 | 48 | 48 |
| New entity catch-up | 0 idle | n/a | 0 |
| Provider reconciliation (base + vault + stats) | 3 | 48 | 144 |
| Service reconciliation (metadata/status) | 1 | 48 | 48 |
| Pact reconciliation (base + terms + capacity, 2 pacts) | 6 | 48 | 288 |
| Released coverage reconciliation | 0 | 48 | 0 |
| Finalized incident reconciliation | 0 | 48 | 0 |
| Terminal claim reconciliation | 0 | 48 | 0 |
| Studio monitor probe | 3 | 48 | 144 |
| **Worker normal total** | | | **960** |
| API chain-health cache misses (maximum at 30-minute cache) | 1 | 48 | 48 |
| **Estimated normal total including API** | | | **1,008** |

The worker-only normal estimate is therefore about **960 calls/day**, and the conservative normal total is about **1,008 calls/day** if readiness is exercised at the cache boundary. This is a model, not a claim about provider-side quota accounting.

### New activity

A new Pact normally costs three calls: base Pact, terms, and capacity. For example, 50 newly created Pacts add approximately:

```text
50 x 3 = 150 calls
```

A new Service costs one base call. A new Provider costs three; a new non-final Incident costs two or three depending on whether a resolution/challenge exists. The local budget stops further chain requests when the cumulative count reaches 1,400; it does not delete or rewrite indexed data.

### First repair/catch-up

The one-time legacy cursor repair reset each per-kind frontier to ID 1 transactionally, recorded a durable repair-start marker, and advanced only after each complete projection. The production repair completed naturally and used:

```text
1 counters
1 protocol config
20 top-level entity reads
2 provider child views
4 pact child views
6 incident child views
--
34 indexer calls
10 bounded reconciliation calls
2 worker deployment-verification calls
--
46 chain calls attributable to the worker repair/startup window
```

The same worker window also made three Studio monitor calls, for 49 total actual sends recorded by its transport metrics. A subsequent restart added two worker deployment checks, two indexer calls, and ten bounded reconciliation calls; the API independently performed two cached-path deployment checks. The final shared count at the bounded observation was 107.

### Safety ceiling and headroom

```text
configured local ceiling: 1,400 requests/day
estimated normal total:   1,008 requests/day
estimated worker-only:       960 requests/day
normal reserve:              392 requests/day
final observed count:         107 requests/day
observed reserve:           1,293 requests/day
```

The final observed count is 7.6% of the local ceiling. The model is approximately 99.1% below the old 110,880-call static estimate; this comparison is explicitly between a static before-model and a static after-model, not between two provider-side measurements.

The budget and cooldown are persisted in `/opt/faultpact/.runtime/studio-rpc-scheduler.json` (mode `0600`). A restart reloads the UTC-day count, next-request reservation, and cooldown. Exhaustion or an unreadable/corrupt state file fails closed for chain requests while API/web and cached projections remain available.

## Expected operational effect

- Idle historical entities are not reread every poll.
- Append catch-up is contiguous and batch-bounded.
- Mutable provider/service/pact state and nonterminal coverage/incident/claim state are refreshed at the lower reconciliation cadence.
- Terminal coverage/incidents/claims and chain-owned evidence are not part of routine reconciliation.
- A 429/JSON-RPC quota response opens a shared cooldown; all chain-dependent jobs and Studio monitor probes suppress until the persisted deadline plus safety margin.
- Non-Studio infrastructure probes retain their original monitoring cadence.
- The scheduler's `actuallySent` metric, rather than log volume, reservations, or TCP observations, is the authoritative local outbound-call count.
