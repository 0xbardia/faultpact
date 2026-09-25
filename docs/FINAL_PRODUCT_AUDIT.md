# FaultPact V1 Final Product Audit

Audit date: 2026-09-23. Workspace: `/root/faultpact`. Live product: <https://faultpact.bydx.fun>.

## Executive Summary

The Phase 4 candidate audit verified the public read product and its previous regression suites. The Phase 4.2 re-audit found the write console still incomplete and could not repeat live schema certification because Studio returned HTTP 429. The current release remains blocked; prior candidate results below are historical and are not a substitute for the outstanding Phase 4.2 gates.

V1 publication is blocked. The web console does not expose Provider registration, Service creation, Pact drafting/publication, Provider capital transactions, Claim filing, or claimable-credit withdrawal. A real browser-wallet write has not been completed. Studio HTTP 429 responses leave the indexer cursor degraded; `/api/v1/ready` now correctly returns 200 with a visible degraded status while the database and indexed-read API are available. No tag or GitHub Release was created.

## Contract Integrity

- Contract: `0xeb858957e3C426597245f6b59E260f1cC556Bf13`; GenLayer Studio Development Preview, chain `61997`.
- `contracts/FaultPact.py` SHA-256 at start and after implementation: `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e`.
- Contract modified: **NO**. Contract redeployed: **NO**.
- The candidate certification previously recorded matching live source/schema/chain and 78/23/55/4 methods. The Phase 4.2 live schema recheck returned HTTP 429; current live schema status is unavailable, not mismatched.

## Real User UX Audit

- The first viewport defines Providers, bonded SLA terms called Pacts, Coverage, evidence, GenLayer facts, and deterministic contract settlement. Studio Dev and chain 61997 are visible.
- Explore, Providers, Services, Pacts, Coverages, Incidents, Claims, monitoring, and docs are browsable without connecting a wallet.
- Pact details show Provider, Service, scope, active SLA clauses, Coverage bounds, capacity, premium rate, duration, deductible, maximum payout, and claim deadline. Disabled clauses say “Not applied”; amounts display exact GEN.
- Coverage review explains the estimated premium and selected Pact before wallet confirmation. An invalid Pact ID errors instead of silently selecting another Pact.
- Incident pages separate observation, submitted evidence, canonical facts, challenge, Pact evaluation, and Claims. GenLayer resolves Incident facts; the frozen contract checks Pact terms and settlement.
- Evidence labels use onchain provenance and canonical support/exclusion IDs. External source bytes and submitted hashes are marked not checked by the app. The submitted SHA is described as a byte fingerprint, not proof of truth.
- Provider profiles display total, allocated, reserved, and pending capital. Reserved capital is described as backing for active Coverage and Claims; Provider write actions remain explicitly unavailable.
- Claim pages are indexed receipts. Filing and claimable-credit withdrawal are not exposed in the console.

## Frontend Code Audit

- Fixed incorrect GEN and basis-point rendering, Pact fallback selection, raw Unix observation times, missing Incident Claim links, fabricated evidence verification statuses, and misleading review-only wallet controls.
- Added dynamic page metadata and true docs 404 responses, a skip link that focuses the main content, and a small-value capital layout that fits exact GEN amounts at desktop and mobile widths.
- No unsafe HTML rendering was found in the reviewed pages. API error, empty, and loading states remain visible. Client navigation, wallet/network messaging, and reduced-motion behavior were checked.
- Production-mode Playwright covers the landing page, explorer, time formatting, Pact capital layout, Incident settlement/evidence, docs navigation, mobile navigation, keyboard skip navigation, purchase review, invalid Pact selection, API failure, and reduced motion.

## Typography

The site uses the existing system Arial stack; body copy is 15px with 1.5 line height. Labels and helper text use compact 11–13px sizes, with financial values semibold and exact. Long GEN values use a 16px treatment in capacity metrics; hashes and addresses remain monospaced and copyable. No remote font dependency or font-loading shift was introduced.

## AI-Slop Review

The landing page’s hardcoded “live” metrics and infinite telemetry motion were removed. Its static lifecycle graphic maps to FaultPact’s actual capital → monitoring → evidence → fact resolution → settlement flow. The route-by-route review found no decorative art or invented product data that needed to remain:

| Page | Product-specific visual and copy review |
| --- | --- |
| `/` | Replaced fake telemetry with the actual Pact lifecycle; states bonded capital, monitoring, evidence, GenLayer fact resolution, and contract settlement. |
| `/explore` | Uses the real Provider/Service/Pact records and filters; no demo metrics or filler panels. |
| `/providers`, `/providers/[id]` | Provider list and actual capital balances/status; no fabricated rating or performance score. |
| `/services`, `/services/[id]` | Names the real monitored service and its linked Provider/Pacts; no stock artwork or decorative chart. |
| `/pacts`, `/pacts/[id]` | Pact-specific terms and backed-capital hierarchy; no generic gradient/glow treatment or decorative metrics. |
| `/coverages`, `/coverages/[id]` | Actual indexed customer positions, terms, and deadlines; no fake purchase success state. |
| `/incidents`, `/incidents/[id]` | Actual observation, provenance, evidence, facts, challenge, evaluation, and Claims; no visualization that implies GenLayer sets payout. |
| `/claims`, `/claims/[id]` | Stored claim receipts and contract state; no placeholder filing action presented as working. |
| `/app/*` customer workspace | Transaction review and connection states only; write gaps are named instead of filled with pretend dashboard data. |
| `/provider/*` | Read-only indexed records and explicit unavailable write actions; no simulated vault controls. |
| `/monitoring`, `/status` | Operational probe and cursor data with freshness; no empty chart or decorative live status. |
| `/docs`, `/docs/*` | Text-first technical reference with ordinary hierarchy and links; unknown slugs return a real 404. |
| `not-found`, `error` | Branded recovery message with a useful navigation route; no generic template stock illustration. |

No generic gradient hero, purple/cyan AI treatment, icon-in-circle repetition, decorative blobs, glassmorphism, fake chart, or stock illustration remains in the reviewed UI. The social preview and screenshots use the existing FaultPact identity and live product captures.

## SEO Audit

- Home HTML has title `FaultPact — Reliability with consequences`, a factual description, canonical `https://faultpact.bydx.fun`, Open Graph title/description/image, and `twitter:card=summary_large_image`.
- Public route titles are specific. Dynamic Provider, Service, Pact, Coverage, Incident, and Claim pages use their record title. Private workspace/status layouts are noindex.
- `/robots.txt` allows public routes, blocks private consoles, and references `/sitemap.xml`. The sitemap lists public product and docs pages, not wallet-only states.
- `/icon.svg`, `/social-preview.png`, robots, and sitemap return successfully. Unknown docs slugs return HTTP 404. No structured data was added because no additional organization or review facts are appropriate to assert.
- Desktop and mobile live route sweeps returned the expected 200s and the expected 404 for an unknown docs slug. No localhost or staging canonical was found in the fetched home metadata.

## Accessibility

- Keyboard Tab reaches “Skip to main content” first; activating it moves focus to `#main-content`.
- Visible `:focus-visible` styling, named navigation, form labels, semantic table headers, and reduced-motion behavior were checked. The browser E2E suite asserts skip navigation and reduced motion.
- Live routes at 390px showed no horizontal overflow. This was a focused manual/browser pass; a formal axe scan and numeric contrast report were not run.

## Backend Audit

- API routes use bounded pagination and validated filters. The Incident Claim filter accepts decimal IDs, returns 400 for invalid input, and is covered by API/DB tests. Database errors are sanitized for clients.
- `/api/v1/health` and `/api/v1/ready` return 200. Readiness reports `ready: true`, `degraded: true`, `externalRpc: degraded`, and `indexer: degraded`; the database is healthy and the chain-id probe responds, while worker calls remain quota-limited.
- Shared RPC transport serializes reads, deduplicates identical in-flight requests, honors `Retry-After`, applies bounded cooldown/backoff and jitter, and avoids browser schema discovery.
- Monitoring keeps operational probe state separate from contract facts; monitoring unit tests pass. SSRF and response-boundary controls remain covered by existing monitoring tests and security documentation.
- Observability logs include service, region, operation/entity, and error context without printing keys. The worker currently records Studio 429s and retains indexed records.

## Database Audit

- Prisma schema validation passes. Migration `0003_evidence_status_and_claim_lookup` was applied to production; `prisma migrate status` reports three migrations and no pending work.
- The migration makes app verification nullable, clears old inferred external-source verification metadata, and indexes Claims by Incident. Existing evidence bytes and financial rows were not deleted.
- Monetary columns retain `NUMERIC(78,0)` precision. The Evidence table currently has seven records; all seven show `NOT_CHECKED`, nullable `usable`, and no fabricated artifact association.

## Indexer Audit

- Upserts remain idempotent. Temporary RPC errors do not delete previously indexed entities.
- Partial scans mark the overall cursor degraded. A 429 stops the entity scan; claim reconciliation also stops at the first shared cooldown instead of querying every Claim. Regression tests cover partial failures, retained rows, cooldown stop behavior, and evidence status.
- The live cursor remains `DEGRADED` because Studio returned repeated 429 responses during worker sync. Readiness keeps this visible without marking indexed reads unavailable.

## Monitoring Audit

The monitoring test suite passes 31 tests covering response limits, chain validation, stale state, aggregation, P95, availability/error aggregation, and error classification. Probe signals remain operational evidence and do not make final Incident or settlement decisions. No new monitoring change was required.

## Security Audit

- No new Critical or High application finding was identified in this scoped re-audit. No contract source change was made.
- The repository uses bounded request bodies, schema validation, prepared Prisma queries, protected target-management operations, safe external-source links, and exact immutable artifact bytes.
- Existing contract review limitations remain: F-04 can impose resource/liveness cost because the pinned contract SDK reads a remote evidence body before content checks; its timeout path eventually terminates unresolved incidents. F-06 means a failed external native GEN transfer can consume the withdrawing EOA’s internal credit without an application recovery callback.
- `gitleaks` was not installed. A targeted repository signature scan found no matching private-key or common token signatures; this is not represented as a full gitleaks scan.

## Live User Testing

- From the public site, the user can browse product records and docs before wallet connection. The buy screen reaches a real disconnected-wallet error and keeps the selected Pact.
- Desktop and 390px mobile sweeps each covered 23 routes: all public product routes returned 200, the unknown docs route returned 404, and none overflowed horizontally.
- The final Pact screenshot confirms the action is beside the page navigation, long exact GEN values fit, and the freshness label remains unobscured.
- A real wallet confirmation and write could not be performed: `E2E_TEST_PRIVATE_KEY` is absent and the available browser has no injected MetaMask/Rabby provider. The purchase review E2E validates the disconnected state only.
- The API health route returned 200, but readiness returned 503 with `indexer=degraded`. Worker logs show Studio HTTP 429 cooldowns; indexed records remain available and are not cleared.

## Bugs Found

| Symptom | Root cause | Fix | Regression |
| --- | --- | --- | --- |
| Landing page showed fixed values as “live”. | Hardcoded metrics and looping decoration. | Replaced with the real product lifecycle and removed infinite movement. | Desktop/mobile live review; landing E2E. |
| Pact terms were hard to compare; invalid IDs could select another Pact. | Raw BPS/wei presentation and list fallback. | Exact GEN/BPS formatting, complete terms, selected-ID lookup, explicit errors. | Formatter and invalid-selection E2E. |
| Incident list showed Unix seconds; details omitted Claims. | Raw timestamp cell and no Incident-filtered Claim request. | Human date formatting and indexed Claim ledger. | Timestamp and Incident Claim E2E. |
| External evidence displayed as fetched/hash-valid despite mismatch or 503. | Indexer inferred app checks from fields absent in the frozen Evidence record. | Store `NOT_CHECKED`, nullable usability, remove fabricated artifact link, explain submitted hash and provenance. | Indexer test, Incident E2E, live Incident review. |
| Studio 429 caused repeated entity and Claim reads. | Cooldown handling stopped the main scan but not reconciliation. | Stop both loops at the first shared 429. | Indexer cooldown regression. |
| Keyboard users had no skip navigation. | No skip link or focusable main target. | Added a first-Tab skip link and focusable target. | Keyboard E2E. |
| Exact small GEN capacity values overflowed or lost freshness behind a fixed CTA. | Large values in a three-column side panel and a viewport-fixed button. | Compact stacked capital metrics and contextual page-header action. | Pact layout E2E at desktop/mobile and live screenshot review. |

## Test Results

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | 74 PASS / 0 FAIL / 0 SKIP |
| `pnpm test:integration` equivalent | 2 PASS / 0 FAIL / 0 SKIP (PostgreSQL and frozen live source/schema/chain) |
| `pnpm test:e2e` | 12 PASS / 0 FAIL / 0 SKIP; includes production build |
| Python Phase 0.1 contract regressions | 38 PASS / 0 FAIL / 0 SKIP |
| Prisma validate | PASS |
| Production migration status | PASS; 3 migrations, no pending migrations |
| Live wallet write | NOT AVAILABLE; no injected wallet in the browser profile |

## Performance

Next production build reports 102KB shared first-load JavaScript and 121KB first load on the home/explorer pages. The home page is statically generated, uses no remote font, and the social image is 1200×630. LCP/CLS lab scores were not collected in this pass.

## GitHub Repository

- Public repository: <https://github.com/0xbardia/faultpact>.
- About description: `Bonded SLAs for critical infrastructure, independently resolved when things fail.`
- Homepage: <https://faultpact.bydx.fun>.
- Topics: `genlayer`, `infrastructure`, `monitoring`, `nextjs`, `reliability`, `rpc`, `sla`, `smart-contracts`, `typescript`, `web3`.
- README, architecture diagrams, security reporting, operations/deployment docs, tests, and live production screenshots are present. No license is declared.
- GitHub social preview image is prepared at `apps/web/public/social-preview.png`. The current authenticated `gh` interface cannot upload it; upload it manually in repository **Settings → Social preview**.

## Release

- Candidate changes are not tagged as `v1.0.0`.
- GitHub Release: not created; release gate remains open.
- Candidate source commit: `ed9de59fc5b5f7d95acab315987b7a46745fbfd9` (`fix: final FaultPact product polish`); the audit and submission artifacts are recorded in the follow-up commit.
- Submission archive: `release/FaultPact-v1.0.0-submission.zip`.
- Submission SHA-256: `a2c3e1ae3b16e9e2aab2a9bc79bde4dbd292d56cb36b0aca7f51c820066ac7a6` (also recorded in the sibling `.sha256` file).

## Remaining Limitations

1. Provider registration, Service creation, Pact draft/publish, capital deposit/allocation/withdrawal, Claim filing, and credit withdrawal are not implemented in the web console.
2. Browser wallet confirmation and a state-changing payable transaction were not available to test.
3. Studio HTTP 429 keeps worker cursors degraded and API readiness at 503; the index remains readable and preserves prior rows.
4. F-04 and F-06 contract runtime limitations remain as described under Security Audit.
5. GitHub social preview needs one manual upload.

## Final Verdict

**FAULTPACT V1 FINAL PRODUCT PARTIAL — RELEASE BLOCKED**

## Phase 4.2 Re-audit Update — 2026-09-23

This section supersedes the candidate-time readiness, integration, and live
schema statements above where they differ.

- PostgreSQL was recovered after a full-filesystem incident. The public API and
  indexed list/status endpoints return HTTP 200 again.
- `/api/v1/ready` now reports `ready: true`, `degraded: true` while the indexer
  cursor is stale. Database loss and an unverified deployment still return 503.
- Studio still returns HTTP 429 to live contract-schema certification. The
  local frozen schema remains available; live schema verification is
  **unavailable**, not a mismatch.
- Deterministic tests now pass: unit 78/78 and integration 1/1. Lint,
  typecheck, Prisma schema validation, and test-database migration status pass.
- Production build, lint, and typecheck pass. A full post-fix Playwright sweep
  has not been run; live CLI smoke checks of the homepage and Explorer showed no
  browser console errors. A real wallet write and payable wallet write have not
  been proven.
- Provider write UI, Claim filing, and credit withdrawal remain unavailable;
  no release tag or GitHub Release was created.

See [Phase 4.2 blocker closure](PHASE_4_2_RELEASE_BLOCKER_CLOSURE.md) for the
symptom/root cause/fix/verification record and current gate state.
