# FaultPact

**Reliability with consequences.**

FaultPact is a Service Reliability Exchange for infrastructure providers and
customers. Providers bond capital behind measurable service commitments;
customers buy Coverage; monitoring produces evidence; GenLayer resolves
canonical Incident facts; and frozen Pact terms determine claim eligibility.

## What FaultPact does

FaultPact connects operational reliability to economic accountability:

```text
Provider → Service → Pact → Coverage → Monitoring → Incident → Evidence
         → GenLayer Resolution → deterministic Claim → Settlement
```

The contract is the financial source of truth. PostgreSQL indexes onchain state
and stores monitoring history; it does not replace contract settlement logic.

## Why bonded SLAs

An SLA is more useful when its terms, backing, evidence, and settlement path are
inspectable. FaultPact makes the protected scope and capital constraints visible
before Coverage is purchased, then keeps Incident facts separate from the
Pact-specific claim evaluation that follows.

## Architecture

![FaultPact architecture](docs/architecture/faultpact-system.svg)

The source diagram is [faultpact-system.mmd](docs/architecture/faultpact-system.mmd).
The contract remains authoritative for Provider, Pact, Coverage, Incident,
Claim, credit, and final settlement state.

## Live deployment

- Website: <https://faultpact.bydx.fun>
- Network: GenLayer Studio Development Preview
- Chain ID: `61997`
- Contract: `0xeb858957e3C426597245f6b59E260f1cC556Bf13`
- Frozen source SHA-256: `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e`

The site, API, indexer, worker, and evidence endpoint are deployed and read
verified. The final release remains blocked until the real browser-wallet write
path and a fresh live schema request can be independently completed; see the
[Phase 4 certification](docs/PHASE_4_FINAL_SYSTEM_CERTIFICATION.md).

## Screenshots

These are captured from the deployed read-only product surface:

| Surface | Preview |
| --- | --- |
| Landing | [desktop](docs/assets/screenshots/landing-desktop.png) · [mobile](docs/assets/screenshots/landing-mobile.png) |
| Explorer | [explore](docs/assets/screenshots/explore-desktop.png) |
| Pact | [Pact detail](docs/assets/screenshots/pact-detail-desktop.png) |
| Incident | [Evidence and resolution](docs/assets/screenshots/incident-evidence-desktop.png) |
| Operations | [Monitoring](docs/assets/screenshots/monitoring-desktop.png) |
| Documentation | [Docs](docs/assets/screenshots/docs-desktop.png) |

## Repository structure

```text
apps/api       Fastify public and operational API
apps/worker    indexer, reconciliation, monitoring, evidence work
apps/web       Next.js product frontend
packages/*     contract, database, shared, and monitoring boundaries
contracts/     frozen FaultPact contract source
prisma/        PostgreSQL schema and migrations
docs/          architecture, operations, product, and certification records
```

## Local development

Requirements: Node.js 22, pnpm, and PostgreSQL. Copy `.env.example` to a local
environment file, set `DATABASE_URL`, then run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

The web application uses `/api/v1` by default. The API and worker require the
frozen chain and address configuration; they fail closed on a wrong chain or
deployment.

## Environment

Use variable names only; never commit credentials:

```text
DATABASE_URL
GENLAYER_RPC_URL
GENLAYER_CHAIN_ID
FAULTPACT_CONTRACT_ADDRESS
FAULTPACT_SOURCE_SHA256
EVIDENCE_PUBLIC_BASE_URL
ADMIN_API_TOKEN
REPORTER_PRIVATE_KEY
```

`REPORTER_PRIVATE_KEY` is optional and environment-only. Without it, monitoring
runs in monitor-only mode. User financial actions are wallet-signed in the
browser; the backend does not custody user keys or auto-withdraw credits.

## Testing

The repository includes TypeScript unit/integration tests, the Python contract
regression suite, and frontend Playwright coverage. Run the standard checks with
the commands above and consult the current certification for environment-bound
results.

## Security model

Authoritative evidence requires the hardened contract's reporter provenance,
structured schema, hash, scope, timestamp, and support rules. Supplemental
evidence is a signal, not payout-bearing truth. Reporter quorum counts distinct
authorized reporter identities. Canonical Incident facts are resolved before
Pact terms are evaluated deterministically. The contract source and deployment
are frozen; application layers adapt to them.

Evidence artifacts are canonical bytes addressed by SHA-256 and served without
runtime reserialization. Raw evidence is treated as untrusted JSON/text and is
not rendered as HTML.

## Monitoring

Regional workers probe configured RPC targets, aggregate deterministic windows,
and produce offchain incident candidates. Candidate states are operational
signals only. They do not decide final breach, payout, or claim eligibility.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Backend](docs/BACKEND.md)
- [Indexer](docs/INDEXER.md)
- [Monitoring](docs/MONITORING.md)
- [Evidence pipeline](docs/EVIDENCE_PIPELINE.md)
- [Frontend](docs/FRONTEND.md)
- [Production deployment](docs/PRODUCTION_DEPLOYMENT.md)
- [Operations](docs/OPERATIONS.md)
- [Phase 4 certification](docs/PHASE_4_FINAL_SYSTEM_CERTIFICATION.md)

## Known limitation

F-06 is an accepted GenLayer runtime limitation around external native GEN
transfer failure semantics. The product distinguishes internal claimable
FaultPact credit from a completed external transfer and does not claim that a
withdrawal is received before the contract/runtime outcome is known.

## License

No license is declared in this repository yet.
