# Evidence pipeline

The worker generates `faultpact-probe-v1` artifacts only from structured probe
data. The exact object keys are validated, including service ID, lowercase
region, positive observation window, bounded PPM/latency/block-lag values,
chain-level status, explicit fault domain, probe ID, and sequence. An
unconfirmed artifact must use `fault_domain: "UNKNOWN"`.

The canonical representation is UTF-8 JSON with recursively sorted keys, no
insignificant whitespace, integer protocol metrics, and no floating-point
protocol values. SHA-256 is lowercase 64-hex over those exact bytes. The
artifact is self-checked before it is persisted.

PostgreSQL stores the exact bytes in `EvidenceArtifact.bytes`, keyed by a
unique SHA-256. Existing bytes are compared byte-for-byte; a hash collision or
mutation is rejected. There is no ordinary update or delete flow for artifact
content.

`GET /evidence/:sha256` and
`GET /api/v1/evidence-artifacts/:sha256/raw` serve those stored bytes directly,
with `Content-Type: application/json`, an SHA-based ETag, and immutable cache
headers. The API never parses and reserializes the stored JSON.

Onchain evidence can also point to an external URI. The index preserves that
URI and the submitted hash but does not fetch the source, so the public Incident
view labels fetch, hash, and schema checks as not checked by the app. Artifacts
are not automatically authoritative merely because a worker created them.
Before any future onchain submission, the reporter wallet must be
configured, its address must be authorized by the frozen contract, and the
artifact must pass the same schema, service, scope, time, metric-bound, and hash
checks. Multiple regions use distinct reporter identities; one worker cannot
pretend to satisfy an independent reporter quorum.

`MONITOR_MODE=observe` does not create artifacts. `evidence` can create
immutable artifacts but does not submit transactions. `auto` is reserved for an
explicit future submission implementation and is not enabled by default. The
worker fails closed if `AUTO_ONCHAIN_SUBMISSION=true`; it never pretends that a
submission happened without a verified signer transport.

## Signer-backed submission

The worker can take one canonical artifact through the frozen contract with a
dedicated reporter wallet. This path is explicit, opt-in and never implied by a
configured key alone.

```
generated monitoring evidence
  -> canonical immutable bytes
  -> SHA-256
  -> public immutable artifact URL
  -> exact HTTP byte/hash self-verification
  -> authorized reporter preflight
  -> attach_incident_report -> wait for FINALIZED -> contract read-back
  -> submit_evidence       -> wait for FINALIZED -> contract read-back
  -> persisted proof
```

* Implementation: `apps/worker/src/reporter-submit.ts` (orchestration),
  `apps/worker/src/reporter-runtime.ts` (production wiring),
  `apps/worker/src/reporter-cli.ts` (command), `apps/worker/src/reporter-summary.ts`
  (PASS/FAIL report), `packages/monitoring/src/reporter.ts` (argument
  construction, artifact verification, read-back assertions, retry-safe
  planning) and `packages/contract/src/reporter.ts` (signer).
* Command: `pnpm evidence:submit --incident-id <id> [--dry-run] [--json]`.
* Live proof: `pnpm test:reporter-live`
  (`tests/certification/reporter-live.test.ts`).

### Contract arguments

Argument names and order are asserted against the frozen schema snapshot before
anything is signed.

| Method | Arguments |
| --- | --- |
| `attach_incident_report` | `incident_id, summary, evidence_uri, evidence_hash` |
| `submit_evidence` | `incident_id, evidence_type, evidence_uri, content_hash, description` |
| `get_incident_evidence_ids` | `incident_id` |
| `get_evidence` | `evidence_id` |
| `is_authorized_reporter` | `reporter` |

`attach_incident_report` always records `PROBE_REPORT` evidence. `submit_evidence`
records the configured `REPORTER_SUBMIT_EVIDENCE_TYPE` (default
`THIRD_PARTY_MONITOR`). Both writes submit the *same* artifact URL and SHA-256
and therefore create two distinct, immutable evidence records: one per contract
method. The frozen contract caps authoritative evidence at four per authorized
reporter per incident and supplemental evidence at four per submitter, so the
worker checks the live cap before the second write instead of spending a
transaction on a guaranteed rejection.

### Artifact verification before signing

The public artifact is fetched over HTTPS and the *exact response bytes* are
hashed. The body is never parsed and re-serialized: `JSON.parse` ->
`JSON.stringify` -> hash is not proof of byte equality. The worker fails closed
on a non-200 status, a non-JSON content type, an empty body, a size above
`EVIDENCE_MAX_BYTES`, a `Content-Length` that disagrees with the body, or any
SHA-256 difference between the HTTP bytes, the stored artifact and the
transaction argument.

### Finalization

A submitted transaction is not a successful submission. Each write is polled
through `eth_getTransactionByHash` with bounded exponential backoff until the
transaction is decided. `SUBMITTED`, `PENDING`/`FINALIZING`, `FINALIZED` and
`FAILED` are tracked; HTTP 429, `Retry-After` and temporary RPC failures extend
the backoff instead of forcing rapid re-polls. A bounded wait that expires is
reported as `NOT VERIFIED`, never as a pass. Every SDK call the signer makes
(nonce, gas, raw send, receipt) is proxied through the shared Studio transport,
so reporter traffic obeys the same minimum interval, daily budget and cooldown
as contract reads.

Studio rejects a write whose fee value is zero, so the writer takes the fee
distribution and fee value from the node's own fee policy before signing and
refuses to sign if the node reports zero. Fee values are never hardcoded.

### Submission strategy and short evidence windows

`evidenceSubmissionStrategy` selects how the two records are written:

* `sequential` (default) — sign, wait, read back, then sign the next record.
  This is the documented order and the strongest ordering guarantee.
* `parallel` — sign both records back to back, then wait for and read back each
  of them individually.

Use `parallel` when the protocol evidence window is shorter than two serialized
finalization waits. The current Studio deployment grants a 60 second window
(`incident_evidence_window_seconds`) and Studio finalization can take tens of
seconds, so a live certification run opens its incident and signs both records
immediately. Every verification guarantee is unchanged in `parallel` mode: each
transaction is still waited on to a decided state, each resulting evidence
record is still read back from contract state, and a failure in either record
still fails the run.

### Read-back is contract state

After each finalization the worker reads `get_incident_evidence_ids` and
`get_evidence` and asserts `incident_id`, `uri`, `content_hash`, `submitter`,
`evidence_type`, `provenance`, `reporter_authorized_at_submission` and
`hash_algorithm`. Database or indexer rows are never used as a substitute. The
`Evidence.submitter` field carries the transaction signer, and
`reporter_authorized_at_submission` records the authorization state the contract
evaluated at submission time.

### Retry safety

Each write is persisted in `EvidenceSubmissionAttempt` with the incident, the
artifact URL and SHA-256, the method, the reporter public address, the
transaction hash and lifecycle state, the resulting evidence id, the finalized
timestamp and a failure category. Before a retry the worker checks contract
state and unresolved attempts: evidence that already exists onchain is verified
and not resubmitted, an unresolved transaction is reconciled and not duplicated,
and a partial unique index prevents two unresolved attempts for the same
artifact and method. The reporter private key is never stored in the database.

See [operations](OPERATIONS.md) for reporter setup and
[MONITORING.md](MONITORING.md) for the monitor-side behaviour.
