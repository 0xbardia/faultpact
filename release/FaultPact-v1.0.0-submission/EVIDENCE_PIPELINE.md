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

Artifacts are not automatically authoritative merely because a worker created
them. Before any future onchain submission, the reporter wallet must be
configured, its address must be authorized by the frozen contract, and the
artifact must pass the same schema, service, scope, time, metric-bound, and hash
checks. Multiple regions use distinct reporter identities; one worker cannot
pretend to satisfy an independent reporter quorum.

`MONITOR_MODE=observe` does not create artifacts. `evidence` can create
immutable artifacts but does not submit transactions. `auto` is reserved for an
explicit future submission implementation and is not enabled by default. The
worker fails closed if `AUTO_ONCHAIN_SUBMISSION=true`; it never pretends that a
submission happened without a verified signer transport.
