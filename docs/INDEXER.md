# Indexer and reconciliation

The worker reuses an existing frozen deployment row after validating its source
fingerprint, then reads protocol counters and scans entity IDs in dependency
order: providers, services, pacts, coverages,
incidents, evidence, and claims. Pact terms/capacity, incident
resolution/challenge, and provider vault/stat views are fetched before their
parent projection is committed.

## Incremental bootstrap

`SyncCursor.nextId` is the durable high-water mark for each entity kind. A
cursor advances only after the complete entity snapshot and all required child
projections succeed. Empty responses, missing parents, database errors, and RPC
failures retain the current ID. A failed dependency kind stops later dependent
kinds in that cycle.

The first successful deployment of this version performs one bounded legacy
cursor repair from ID 1 and writes a `LEGACY_CURSOR_REPAIRED` audit record only
after every kind succeeds. This repairs cursors written by the older
advance-on-failure implementation. Later processes resume from the verified
cursors and do not reread finalized immutable rows every cycle.

Entity and anomaly writes are idempotent on the frozen deployment/onchain ID.
Reconciliation status and its anomaly audit are committed in the same database
transaction. Raw JSON is retained and onchain/financial quantities use
PostgreSQL `NUMERIC(78,0)` / Prisma Decimal.

## Reconciliation matrix

Reconciliation is bounded to `INDEXER_RECONCILE_LIMIT` total candidates per run,
not per table. Candidates are selected oldest-indexed-first and interleaved
across entity kinds so one large table cannot starve the others.

The safe mutable set is:

- all providers (vault, stats, ownership, and metadata remain mutable);
- all services, including retired metadata;
- all pacts, including retired capacity balances;
- non-`RELEASED` and unknown-status coverages, including `EXPIRED`;
- non-`FINALIZED` and unknown-status incidents;
- `PENDING_RESOLUTION` and unknown-status claims;
- immutable evidence only through the incremental bootstrap cursor.

Terminal claims and released coverages are not repeatedly reread. Finalized
incidents are excluded only after a complete parent/resolution/challenge
snapshot has been projected. The reconciliation cursor is stored as the
existing `SyncCursor` entity kind `reconciliation`; no database migration is
required.

## Scheduling and failure behavior

All production Studio calls use `StudioRpcTransport`. It serializes requests,
enforces a configurable minimum interval, honors `Retry-After`, persists shared
cooldown/budget state, retries only temporary transport/5xx failures, and exposes
attempt/send/success/error/suppression metrics by method and subsystem.

When a cooldown or local budget is active, the indexer sleeps until the shared
eligible time instead of executing sync and reconciliation jobs every poll
interval. A failed scan does not run reconciliation. Repeated identical
cooldown errors are suppressed; the worker logs the transition, suppressed job
count, expiry, and recovery. Existing rows remain available through the API
throughout.

`/api/v1/ready` checks both the `all` bootstrap cursor and the durable
`reconciliation` cursor. RPC or reconciliation degradation returns HTTP 200 with
`degraded: true` when PostgreSQL and the cached verified deployment are
available. Database loss or a missing/unverified deployment remains HTTP 503.
