# FaultPact release-candidate submission

**Status: unreleased candidate — final certification partial; no `v1.0.0` tag
or GitHub release.**

## Project

- Project: FaultPact
- Tagline: Reliability with consequences.
- One-liner: Bonded SLAs for critical infrastructure, independently resolved
  when things fail.
- Website: <https://faultpact.bydx.fun>
- GitHub: <https://github.com/0xbardia/faultpact>

## Network and frozen contract

- Network: GenLayer Studio Development Preview
- Chain: `61997`
- RPC: `https://studio-dev.genlayer.com/api`
- Contract: `0xeb858957e3C426597245f6b59E260f1cC556Bf13`
- Source SHA-256: `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e`

The local and deployed contract bytes were independently compared and matched.
The contract was not modified or redeployed.

## Problem

Infrastructure customers can suffer real operational loss while conventional
SLAs leave measurement, responsibility, and payout disconnected. Providers also
need a credible way to demonstrate that their commitments are backed by capital.

## Solution

FaultPact binds service commitments to bonded Provider capital. Coverage has
visible terms and capacity. Monitoring produces objective telemetry and
content-addressed evidence. GenLayer resolves canonical Incident facts, while
the frozen contract evaluates Pact terms and settles eligible Claims.

## How it works

```text
Provider → Service → Pact → Coverage → Monitoring → Incident → Evidence
         → GenLayer Resolution → deterministic Claim → Settlement
```

The database is an index, cache, search layer, and monitoring store. It is not a
second settlement engine.

## GenLayer usage

The application targets Studio Dev chain 61997 and the frozen FaultPact
deployment. The application records preliminary and final transaction states
without claiming finality at submission time. Fresh live schema verification was
blocked by the Studio RPC daily quota at certification time; the verified frozen
schema snapshot is 78 methods, 23 views, 55 writes, and 4 payable methods.

## Monitoring and evidence

Regional workers probe RPC services, calculate deterministic windows, identify
offchain incident candidates, and produce canonical evidence bytes. Each
artifact is SHA-256 addressed and served at an immutable URL. Supplemental
evidence is never treated as payout-bearing truth. Authoritative evidence must
match the frozen reporter/provenance and structured schema rules.

## Security

- Contract source/deployment fingerprint is checked against the frozen value.
- Chain confusion fails closed at the adapter boundary.
- User financial actions are wallet-signed; the server does not custody user
  keys.
- Reporter keys are optional, isolated, environment-only, and never stored in
  PostgreSQL.
- Monitoring targets are internal/admin-controlled and SSRF constrained.
- Raw evidence is escaped/served as bytes rather than rendered as HTML.
- Contract and application audits are retained in `docs/`.

## Tests and current blockers

- TypeScript unit tests: 59 passed, 0 failed, 0 skipped.
- Phase 0.1 contract regression tests: 38 passed, 0 failed, 0 skipped.
- Frontend Playwright tests: 7 passed, 0 failed, 0 skipped.
- Lint, typecheck, build, Prisma validation, and production migrations: pass.
- Production DNS/TLS, API readiness, real evidence hash verification, and
  read-only browser routes: pass.
- Final live schema request: blocked by Studio HTTP 429 quota.
- Real MetaMask browser write: blocked because automated headed Chromium did not
  expose a usable account-confirmation target; no scripted write was substituted.

These blockers prevent final system certification and release tagging.

The unreleased candidate is published on `main` at commit
`f5b9e4e08075ac584bf4f7f319ec36e78aacd1ad`. No `v1.0.0` tag or GitHub release
was created.

## Screenshots

See `screenshots/` for curated production read-surface captures:

- landing desktop and mobile
- explorer
- Pact detail
- Incident/evidence
- provider dashboard
- customer dashboard
- monitoring
- docs

## Architecture

See `architecture/faultpact-system.mmd` and `architecture/faultpact-system.svg`.

## Known limitation

F-06 remains an accepted GenLayer runtime limitation around external native GEN
transfer failure semantics. FaultPact distinguishes internal claimable credit
from a completed external transfer and does not auto-withdraw or misreport
receipt.

## Links

- [Full Phase 4 certification](PHASE_4_FINAL_SYSTEM_CERTIFICATION.md)
- [Production deployment](PRODUCTION_DEPLOYMENT.md)
- [System architecture](architecture/faultpact-system.mmd)
- [Evidence pipeline](EVIDENCE_PIPELINE.md)
