# FaultPact Phase 3 Frontend Certification

## Frozen Contract

- Chain: `61997`
- Address: `0xeb858957e3C426597245f6b59E260f1cC556Bf13`
- Source SHA-256: `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e`
- Contract modified: **NO**

## Frontend Stack

Next.js App Router, TypeScript, React, native fetch/query hooks, CSS design
tokens, EIP-1193 wallet boundary, and the existing Phase 1/2 Fastify API.
The implementation intentionally avoids a second financial state machine and
does not add a UI dependency for behavior covered by platform APIs.

## Route Map

Landing: `/`

Explorer: `/explore`, `/providers`, `/providers/[id]`, `/services`,
`/services/[id]`, `/pacts`, `/pacts/[id]`, `/coverages`, `/coverages/[id]`,
`/incidents`, `/incidents/[id]`, `/claims`, `/claims/[id]`

Application: `/app`, `/app/purchase`, `/app/claims/[id]`, `/provider`,
`/provider/capital`, `/provider/pacts`, `/monitoring`, `/status`

Documentation: `/docs` and the documented nested slug routes.

## Design and product review

The landing page uses a product-native reliability pipeline: provider bond,
monitoring, evidence, canonical facts, deterministic settlement. CSS motion is
meaningful, bounded, mobile-safe, and disabled coherently for reduced motion.
The palette is warm paper/ink with coral/lime signal colors. No fake stats,
testimonials, partners, AI imagery, or sample incidents are rendered.

## Integration

Public pages read the real API. Local live data includes indexed Providers,
Services, Pacts, Incidents, Evidence, and monitoring rows. Pact detail includes
real indexed terms/capacity; Incident detail separates canonical facts,
support IDs, and excluded evidence. The API is labeled indexed/monitoring and
the contract remains the financial source of truth.
Immutable evidence bytes were independently served from the real PostgreSQL
artifact store through the API's `.json` URL and rehashed byte-for-byte.

## Wallet and transactions

Disconnected browsing and wrong-network handling are implemented. The review
surface refuses to send a transaction because the current frozen GenLayer
deployment's browser write transport is not independently verified. No private
key is sent to the API and no action is reported as finalized prematurely.

## Current evidence

- Local API health/readiness: verified on chain 61997 with the frozen address.
- Browser review: landing desktop/mobile, public explorer, Pact detail, Incident
  detail, monitoring, purchase review, wallet-absent error, docs, and responsive
  navigation exercised with Playwright CLI.
- Live wallet writes: **NOT RUN — no test wallet/private key and no verified
  browser write transport**.
- `faultpact.bydx.fun` DNS/TLS: **NOT TESTED in this local execution**.
- Final live integration rerun: database integration passed; the contract schema
  check was blocked by the Studio RPC's `429` rate limit (`retry-after` about
  875 seconds). The same frozen source/schema/chain integration had passed before
  that external quota was exhausted.

## Test counts

- Unit: **58 PASS / 0 FAIL / 0 SKIP**
- Database integration: **1 PASS / 0 FAIL / 0 SKIP**
- Frozen live-contract integration: **0 PASS / 1 FAIL / 0 SKIP**, external RPC
  rate-limited after the earlier successful verification
- Python Phase 0.1 regression suite: **38 PASS / 0 FAIL / 0 SKIP**
- Browser review: production build exercised with Playwright CLI; no console
  errors on the verified landing, explorer, Pact, Incident, docs, monitoring,
  and purchase-review routes.
- Permanent Playwright E2E: **7 PASS / 0 FAIL / 0 SKIP** covering landing,
  indexed explorer shape, docs navigation, mobile navigation, disconnected
  purchase review, API failure state, and reduced motion.
- Lint: **PASS**
- Typecheck: **PASS**
- Production build: **PASS**

## Remaining limitations

F-06 remains the accepted GenLayer external native-transfer limitation. The UI
distinguishes claimable internal FaultPact credit from completed external GEN.
The current write transport and production domain deployment remain explicit
gates for a full frontend pass. `genvm-lint` is not installed in this execution
environment; the frozen contract's prior certification artifacts are preserved
and the frontend does not modify or redeploy the contract.

## Final Status

**FAULTPACT PHASE 3 PARTIAL — BLOCKERS REMAIN**

The read/explorer/documentation foundation is implemented and verified locally;
the remaining blockers are verified browser writes and actual production domain
deployment, not a fabricated success state.
