# Indexer and reconciliation

The worker verifies chain ID, deployed source bytes, source SHA-256, and the
final schema before indexing. It reads protocol config and counters, then walks
bounded entity IDs for providers, services, pacts, coverages, incidents,
evidence, and claims. Pact terms/capacity, incident resolution, and provider
vault/stat views are refreshed with their parent records.

Entity writes are idempotent on `(deployment, onchain_id)`. Raw JSON is retained
and numeric onchain values use PostgreSQL `NUMERIC(78,0)` / Prisma Decimal;
JavaScript `Number` is not used for financial quantities.

RPC calls are rate-limited and retry HTTP 429 responses. A failed entity read
does not delete an existing row. The entity cursor is marked degraded with the
exact error, while later entities continue where possible. The all-entity
cursor controls readiness.

Reconciliation is one-way: it compares active indexed claims to contract views
and records an anomaly when the contract status differs. The contract status is
written to PostgreSQL; the worker never attempts to repair the contract from a
database value.

Active state is refreshed on each poll. Historical rows remain available for
search and audit. Raw probe samples are short-lived operational data; indexed
onchain state and immutable evidence artifacts are not subject to probe
retention cleanup.
