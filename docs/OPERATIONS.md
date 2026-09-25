# Operations

## Startup

1. Provision PostgreSQL 16 (the checked-in compose file) and a secret
   `POSTGRES_PASSWORD`.
2. Run `pnpm db:generate` and `pnpm db:migrate`.
3. Start API and worker with the same frozen deployment environment.
4. Confirm `/api/v1/health`, `/api/v1/ready`, `/api/v1/status`, and worker
   heartbeats.

`infra/docker/compose.yml` runs PostgreSQL, API, and worker. It requires an
   explicit database password and does not include a default credential. Host
   Nginx can route `/api/` to port 4310 and `/evidence/` to the same API; the
   later frontend owns `/`. Validate any host configuration with `nginx -t`
   before reload. This repository does not modify or reload production Nginx.

## Health and logs

Logs are structured Pino records. They may include target/service/region,
probe, incident, artifact, and transaction identifiers, but never keys,
admin tokens, secret headers, or authenticated endpoint URLs. `/ready` requires
database connectivity and a deployment verified during API startup. It returns
`degraded: true` when RPC or indexer freshness is impaired while preserving HTTP
200 for indexed reads. The API may start from a previously verified frozen
deployment row when live verification is in cooldown; this is reported as RPC
degradation, not as a fresh live verification. Database loss or an unverified
deployment remains HTTP 503.

## Credentials and writes

`REPORTER_PRIVATE_KEY` is environment-only and optional. It is never written to
PostgreSQL or returned by the API. The current application does not sign user
financial actions and does not auto-withdraw claimable credits. External GEN
transfer failure semantics remain the contract/runtime F-06 limitation.

## Integration tests

`pnpm test:integration` migrates and tests the isolated local `faultpact_test`
database without requiring a shell `DATABASE_URL`. Create that database once
with PostgreSQL administration, or set `TEST_DATABASE_URL` to another dedicated
database whose name ends in `_test`. Live Studio certification runs separately
with `pnpm test:contract-live`; an RPC 429 is an unavailable certification
result, not a schema mismatch.

## Backup and recovery

Back up PostgreSQL using normal PostgreSQL tooling. The contract remains the
recovery source for indexed state, so a rebuilt database must bootstrap from
the current counters and views. Preserve evidence artifact bytes and hashes;
they are immutable audit material. On RPC failure, keep existing rows and let
the cursor expose degraded state rather than deleting data.

## Scaling

Run one indexer/reconciliation owner per deployment, or coordinate workers so
they do not duplicate the same sync work. Monitoring workers may run
independently per region; each uses its own region identity and, when enabled,
its own authorized reporter key. Keep monitor target creation internal.

The local environment used during development had PostgreSQL 18.6 available;
the deployment definition targets PostgreSQL 16 as requested. Both use the
same migration strategy, but production should certify the exact managed
PostgreSQL version before rollout.

## Certified host deployment

The current host deployment uses systemd units `faultpact-api`,
`faultpact-worker`, and `faultpact-web` behind Nginx for
`faultpact.bydx.fun`. The API listens on loopback port `4310`; the web service
listens on loopback port `4320`. PostgreSQL is local to the host and is not
publicly exposed.

The public checks used for the Phase 4 candidate were:

```text
https://faultpact.bydx.fun/
https://faultpact.bydx.fun/api/v1/health
https://faultpact.bydx.fun/api/v1/ready
https://faultpact.bydx.fun/api/docs/json
```

They returned successfully over HTTPS. The deployment remains a release
candidate rather than a final v1.0.0 release because the live Studio schema
endpoint was rate-limited and the required browser-extension wallet write could
not obtain a usable MetaMask confirmation target in automated Chromium.

## RPC scheduler and quota safety

The API and worker must share one scheduler-state file. The production default is
`.runtime/studio-rpc-scheduler.json` beneath the application working directory;
set `GENLAYER_RPC_BUDGET_STATE_FILE` explicitly when the services do not share
that directory. The file contains only quota/cooldown timestamps and a count,
mode `0600`; it contains no RPC bodies or credentials.

The scheduler enforces one in-flight request, a 3,000 ms production default
spacing, bounded retries for temporary transport/5xx failures, HTTP and JSON-RPC
rate-limit recognition, `Retry-After`, long daily/hourly quota cooldown, and a
FaultPact daily ceiling of 1,400 requests. The ceiling resets at UTC and is a
local safety limit, not a claim about GenLayer's true quota. Exhaustion blocks
outbound Studio requests but does not stop API/web database reads or the worker
heartbeat.

Normal production settings are:

```text
INDEXER_POLL_INTERVAL_MS=300000
INDEXER_RECONCILE_INTERVAL_MS=1800000
INDEXER_RECONCILE_LIMIT=10
GENLAYER_RPC_MIN_INTERVAL_MS=3000
GENLAYER_RPC_DAILY_BUDGET=1400
GENLAYER_RPC_METRICS_INTERVAL_MS=300000
GENLAYER_RPC_PROBE_INTERVAL_MS=1800000
PROBE_INTERVAL_MS=30000
GENLAYER_RPC_BUDGET_STATE_FILE=/opt/faultpact/.runtime/studio-rpc-scheduler.json
```

`PROBE_INTERVAL_MS` remains 30 seconds for non-GenLayer infrastructure probes.
Only a normalized Studio target/reference is slowed to 30 minutes and routed
through the shared scheduler. A Studio target without the shared callback is
suppressed rather than falling back to a direct client.

Inspect scheduler state through the periodic `RPC scheduler metrics` log record
and `/api/v1/status`. Expected keys include `attempted`, `actuallySent`,
`successful`, `http429`, `jsonRpcRateLimits`, `jsonRpcErrors`, `retries`,
`locallySuppressed`, `cooldownRejected`, `budgetRejected`, `byMethod`, and
`bySubsystem`. Do not print or copy the environment file into the repository.

A daily-limit or `Retry-After` cooldown is expected to suspend work until the
reported time. Do not poll the endpoint to test recovery. Historical quota
exhaustion is not a reason to roll back a working scheduler.

## Evidence diagnostics

For an artifact hash `H`, verify both the stored bytes and public response:

```bash
curl -fsS https://faultpact.bydx.fun/evidence/H.json -o /tmp/H.json
sha256sum /tmp/H.json
curl -sSI https://faultpact.bydx.fun/evidence/H.json
```

The response must be JSON, immutable-cacheable, and byte-identical to the
canonical artifact used to calculate `H`.

## Host monitoring

Check unit state and recent structured logs without printing environment files:

```bash
systemctl is-active faultpact-api faultpact-worker faultpact-web
journalctl -u faultpact-api -n 100 --no-pager
journalctl -u faultpact-worker -n 100 --no-pager
```

Transient RPC errors may degrade a cursor, but existing database rows must stay
intact. Investigate repeated heartbeat failures, stale index timestamps, or a
readiness failure before restarting everything.

## Authorized Reporter Setup

The reporter is a dedicated wallet. It is not a user wallet, not a provider
wallet, and not a protocol owner wallet. Without it the worker stays
MONITOR-ONLY and only produces artifacts.

### 1. Create or select a dedicated reporter wallet

```bash
genlayer new --name faultpact-reporter-03        # or reuse an existing reporter keystore
genlayer account 0x…                              # prints the public address only
```

Record the public address. It is the only reporter value that may ever be
logged, stored, or reported.

### 2. Fund it with Studio Dev GEN

Transactions are signed and submitted from the chain layer, so the address needs
GEN on GenLayer Studio Development Preview. An unfunded reporter fails at
submission with a transport error; the preflight still passes, because funding
is not authorization.

### 3. Authorize the public address through the existing contract path

Authorization is a protocol-owner action on the frozen contract. It is
`authorize_reporter(<address>)` and it is deliberately not automated by the
worker:

```bash
genlayer tx call --address 0xeb858957e3C426597245f6b59E260f1cC556Bf13 \
  --function authorize_reporter --args 0x… --from <protocol-owner>
```

Confirm it with a read-only check (this is what the worker's preflight does):

```bash
# is_authorized_reporter(<reporter>) must return true
```

Revoking is `revoke_reporter(<address>)` by the protocol owner. A revoked
reporter must be treated as unauthorized immediately; the worker re-checks
authorization before every submission.

### 4. Configure the private key securely at runtime

```bash
install -m 0600 /dev/null /etc/faultpact/reporter.env
printf 'REPORTER_PRIVATE_KEY=0x…\n' >>/etc/faultpact/reporter.env
```

Point the unit at that file rather than committing a value:

```ini
# /etc/systemd/system/faultpact-worker.service.d/reporter.conf
[Service]
EnvironmentFile=/etc/faultpact/reporter.env
```

The private key must never be committed, stored in PostgreSQL, returned by the
API, logged, included in an exception, or captured in a test snapshot. Only the
derived public address may be reported. `REPORTER_EXPECTED_ADDRESS` is an
optional rotation guard: when set, the worker refuses to sign unless the
configured key derives exactly that address.

### 5. Configure the network, contract and evidence base URL

```bash
GENLAYER_RPC_URL=https://studio-dev.genlayer.com/api
GENLAYER_CHAIN_ID=61997
FAULTPACT_CONTRACT_ADDRESS=0xeb858957e3C426597245f6b59E260f1cC556Bf13
FAULTPACT_SOURCE_SHA256=4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e
EVIDENCE_PUBLIC_BASE_URL=https://faultpact.bydx.fun/evidence
REPORTER_SUBMIT_EVIDENCE_TYPE=THIRD_PARTY_MONITOR
```

`EVIDENCE_PUBLIC_BASE_URL` must be reachable by the public internet, because the
worker fetches the artifact over HTTPS and hashes the response bytes before it
signs anything.

### 6. Start or restart the worker

```bash
systemctl restart faultpact-worker
```

### 7. Inspect the reporter preflight status

```bash
journalctl -u faultpact-worker --no-pager | grep reporter
```

`reporter preflight complete` reports one of:

| Log | Meaning |
| --- | --- |
| `MONITOR_ONLY` + `REPORTER_PRIVATE_KEY is not configured` | no signer; artifacts only |
| `MONITOR_ONLY` + `reporter is not authorized onchain` | key present, contract does not authorize it |
| `AUTHORIZED_SUBMISSION` | signer-backed submission is enabled |
| `reporter preflight deferred` | RPC unavailable; monitoring continues fail-safe |

### 8. Execute the signer-backed evidence command

```bash
pnpm evidence:submit --incident-id <open-incident-id> --dry-run
pnpm evidence:submit --incident-id <open-incident-id>
```

A successful run prints the reporter public address, the incident, the artifact
URL and SHA-256, both transaction hashes, both finalizations, the evidence ids
and the read-back verdict. The private key is never printed. Exit code `0` means
every step verified, `1` means a step failed, `2` means the command could not
run (for example `REPORTER SUBMISSION DISABLED`).

### 9. Run the live integration test

```bash
REPORTER_LIVE_TEST=1 \
FAULTPACT_LIVE_TEST_INCIDENT_ID=<open-incident-id> \
pnpm test:reporter-live
```

Without `REPORTER_LIVE_TEST=1` the suite reports `NOT CONFIGURED` and changes no
Studio state. With it, missing credentials fail the run with an explicit code
(`MISSING_REPORTER_PRIVATE_KEY`, `REPORTER_NOT_AUTHORIZED`,
`MISSING_LIVE_INCIDENT_ID`, `INCIDENT_NOT_OPEN`, `EVIDENCE_WINDOW_CLOSED`,
`WRONG_CHAIN`, `WRONG_CONTRACT`, `ARTIFACT_PUBLIC_URL_UNREACHABLE`,
`ARTIFACT_HASH_MISMATCH`). A missing credential is never reported as a pass.

Set `FAULTPACT_LIVE_TEST_PREPARE_INCIDENT=1` to open a fresh incident with the
frozen contract's own `open_incident` instead of supplying an existing one. This
uses existing contract functionality, mutates no governance state, and attaches
no opener evidence.

### 10. Verify the public transaction and evidence result

```bash
curl -fsS "https://faultpact.bydx.fun/evidence/<sha256>.json" | sha256sum
curl -fsS "https://faultpact.bydx.fun/api/v1/incidents/<id>/evidence"
```

The artifact hash must equal the submitted hash, and the indexed evidence row
must show the reporter public address as `reporter` with the submitted URI. The
authoritative source is the contract view `get_evidence(<id>)`; the API and
PostgreSQL are the indexer projection of it.

### Minimum operational permissions

The reporter wallet needs exactly two things: GEN for transaction fees on chain
61997, and `authorized_reporters[reporter] == true` in the frozen contract. It
does not need provider ownership, guardian status, protocol ownership, capital,
coverage, or claim rights. Keep `report_bond` funding separate: opening incidents
is an opener responsibility, not a reporter responsibility.
