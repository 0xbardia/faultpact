# FaultPact v1.0.0 submission candidate

**Status: unreleased candidate — final certification partial; no `v1.0.0` tag or GitHub Release.**

## Project

- FaultPact — Reliability with consequences.
- Bonded SLAs for critical infrastructure, independently resolved when things fail.
- Website: <https://faultpact.bydx.fun>
- Documentation: <https://faultpact.bydx.fun/docs>
- GitHub: <https://github.com/0xbardia/faultpact>

## Network and frozen contract

- Network: GenLayer Studio Development Preview
- Chain: `61997`
- Contract: `0xeb858957e3C426597245f6b59E260f1cC556Bf13`
- Source SHA-256: `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e`
- Contract modified or redeployed: **NO**
- Candidate source commit on `main`: `ed9de59fc5b5f7d95acab315987b7a46745fbfd9`

## Product and architecture

Providers bond capital behind service SLAs called Pacts. Customers buy Coverage. Monitoring and submitted evidence inform canonical Incident facts; GenLayer resolves facts, and the frozen contract evaluates Pact terms and settles eligible Claims. The contract is the financial source of truth; PostgreSQL is an index/cache/monitoring layer.

```text
User → Web → Wallet → GenLayer → Frozen FaultPact Contract
Contract → Indexer → PostgreSQL → API → Web
RPC Providers → Probe Workers → Aggregation → Immutable Evidence → Reporter → Contract
```

See `docs/architecture/` and `docs/assets/screenshots/` for the architecture and production screenshots.

## Validation

Lint, typecheck, 74 unit tests, 2 database/source/schema/chain integration checks, 12 production-mode Playwright tests, 38 contract regression tests, Prisma validation, and production migration status passed. The browser wallet write was unavailable. Studio HTTP 429 left the worker cursor degraded and API readiness at 503. See `FINAL_TESTING_SUMMARY.md`.

## Remaining limitations

Provider registration, Service creation, Pact draft/publish, Provider capital operations, Claim filing, and claim-credit withdrawal are not exposed in the web console. F-04 and F-06 are documented contract runtime limitations. The release is blocked until required user write workflows and the remaining live operational gates pass.

## Included material

- README, changelog, security guidance, safe environment example, and frozen contract source
- Architecture diagram sources and live production screenshots, including mobile
- Architecture, backend, indexer, monitoring, evidence, frontend, deployment, and operations docs
- Phase 0.1 through Phase 4 audits/certifications, final UX/product audits, and test summary

The archive checksum is distributed as the sibling `.sha256` file in the repository.
