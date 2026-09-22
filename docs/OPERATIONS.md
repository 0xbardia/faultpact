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
database connectivity, chain verification, and a healthy all-entity indexer
cursor.

## Credentials and writes

`REPORTER_PRIVATE_KEY` is environment-only and optional. It is never written to
PostgreSQL or returned by the API. The current application does not sign user
financial actions and does not auto-withdraw claimable credits. External GEN
transfer failure semantics remain the contract/runtime F-06 limitation.

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
listens on loopback port `3001`. PostgreSQL is local to the host and is not
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

## RPC rate limits

The Studio Dev RPC returned HTTP 429 for `gen_getContractSchema` during the final
rerun. The adapter uses bounded retries, jitter, `Retry-After` support, a local
schema snapshot, and degraded verification instead of refreshing the schema per
request. When the quota resets, run the explicit schema certification command
and record the result; do not turn a 429 into a PASS.

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
