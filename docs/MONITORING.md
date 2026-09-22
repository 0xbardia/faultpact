# Monitoring engine

Each worker has a configured lowercase `PROBE_REGION`. A `MonitorTarget` is
created only through the authenticated internal API or trusted database
configuration; public requests cannot choose a URL to probe.

The baseline profile checks `eth_chainId`, `eth_blockNumber`, and
`eth_getBlockByNumber`. Responses must be valid JSON-RPC 2.0 with matching IDs,
valid hex quantities, a structurally valid latest block, and the expected chain.
HTTP 429, non-2xx responses, JSON-RPC errors, malformed JSON, timeouts, wrong
chain, stale heads, and unknown reference heads have distinct outcomes.

SSRF controls require HTTPS by default, resolve every address before connecting,
reject loopback/private/link-local/metadata ranges, reject credentials and
redirects, limit ports, time, and response bytes, and pin the request to the
validated address. HTTP is available only when explicitly enabled for local
development.

Metrics are deterministic:

* availability PPM = floor(successes * 1,000,000 / samples)
* error PPM = floor(failures * 1,000,000 / samples)
* p50/p95 use nearest-rank over measured monotonic latencies
* block lag is `max(reference - target, 0)` and is unknown without a reference

The worker stores rolling five-minute aggregates with the probe IDs used as
inputs. Candidate states (`HEALTHY`, `SUSPECTED`, `ACTIVE`, `RECOVERING`,
`CLOSED`, `EVIDENCE_READY`) are operational signals only. Pact thresholds may
inform a signal, but the contract remains authoritative for final eligibility.

Raw samples are retained for `PROBE_RAW_RETENTION_SECONDS` (default seven days)
and pruned by the monitor worker by region. Aggregates, onchain records, and
evidence artifacts are retained longer; immutable artifact bytes are not
automatically deleted.
