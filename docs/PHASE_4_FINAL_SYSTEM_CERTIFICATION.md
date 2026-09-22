# FaultPact V1 Final System Certification

## Final Verdict

**FAULTPACT V1 FINAL SYSTEM CERTIFICATION PARTIAL — RELEASE BLOCKED**

The deployed application is reachable over HTTPS and its read-only product
surface, API, database, worker, indexer, evidence endpoint, and contract-source
comparison passed the checks that were available. Final release is blocked for
two explicit reasons:

1. Studio Dev returned HTTP 429 for the fresh `gen_getContractSchema` request,
   so the final live schema could not be independently re-confirmed during this
   run.
2. A real MetaMask browser flow was attempted through the deployed FaultPact UI,
   but MetaMask did not expose a usable confirmation target for
   `eth_requestAccounts` in the automated headed Chromium profile. No write was
   signed and no transaction hash exists. The required frontend → wallet →
   contract → indexer → API → frontend proof therefore remains incomplete.

No direct scripted write was used as a substitute. No contract code or state was
changed by this certification.

## Frozen Contract

| Field | Value |
| --- | --- |
| Network | GenLayer Studio Development Preview |
| RPC | `https://studio-dev.genlayer.com/api` |
| Chain ID | `61997` |
| Address | `0xeb858957e3C426597245f6b59E260f1cC556Bf13` |
| Source SHA-256 | `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e` |
| Deploy transaction | `0x980b1a8949173601c80a2bd2b4a15890ad4b8582e763983f895e48ab8f057554` |

## Contract Integrity

- Local source length: **141351 bytes**.
- SHA before work: **exact expected SHA**.
- Deployed code bytes: **141351 bytes**.
- Deployed code SHA: **exact expected SHA**.
- Local/deployed bytes: **equal**.
- Contract modified: **NO**.
- `eth_chainId`: **61997**.
- `gen_getContractCode`: fetched and independently byte-compared.
- `gen_getContractSchema`: **HTTP 429**, Studio Dev daily quota exhausted during
  the final fresh request.
- Previously verified frozen schema snapshot: **78 methods, 23 views, 55
  writes, 4 payable**. This historical count is not represented as a fresh live
  schema PASS in this report.

## Backend

The deployed topology is:

```text
Nginx :443 → Next.js web :3001
         → Fastify API :4310
         → immutable evidence route
PostgreSQL ← API + worker
Worker     → contract reads, reconciliation, monitoring
```

Observed production checks:

- `/api/v1/health`: **PASS**.
- `/api/v1/ready`: **PASS**; database, chain, deployment, and indexer checks
  returned healthy.
- `/api/docs/json`: **PASS**.
- PostgreSQL migration deployment: **PASS**, two migrations found and no
  pending migrations.
- Prisma schema validation: **PASS**.
- Systemd API, worker, and web units: **ACTIVE** at the final runtime check.
- Worker heartbeat: **PRESENT** for `monitor-frankfurt` in observe mode.

The root integration command still reports two failures: the live contract
integration is blocked by the Studio 429, and the database test process did not
receive `DATABASE_URL` in the root shell invocation. Production migration and
readiness were separately verified with the protected service environment.

## Monitoring

The monitor worker runs in monitor-only mode with no automatic reporter write.
The implementation includes bounded RPC retries, jitter, Retry-After handling,
request limits, deterministic aggregation, stale/reference handling, and
canonical evidence artifacts. No final Incident or payout authority is assigned
to offchain monitoring.

The worker's operational heartbeat is visible in PostgreSQL. A worker can be
degraded by upstream RPC quota without deleting existing indexed rows.

## Evidence

Artifact hash independently checked in this run:

```text
b10b37a386484c55cf299de23005c1d3715c17a65c1482b07af3bdfe3c458aaa
```

The public response at:

```text
https://faultpact.bydx.fun/evidence/b10b37a386484c55cf299de23005c1d3715c17a65c1482b07af3bdfe3c458aaa.json
```

returned the exact stored 336-byte artifact. SHA-256 of the HTTP body matched
the path hash on repeated retrieval. The response exposed JSON content type,
an SHA-based ETag, and `Cache-Control: public, immutable, max-age=31536000`.

## Frontend

The deployed Next.js frontend was read-tested against the real production API,
with no browser API mocks. Verified surfaces include landing, explorer, Pact
detail, Incident/evidence, provider dashboard, customer dashboard, monitoring,
and docs. Desktop and mobile screenshots are stored under
`docs/assets/screenshots/`.

The visual review found the intended warm paper/ink, coral, and lime signal
system; no fake statistics, testimonials, partner marks, purple AI gradients,
or placeholder product data were used.

## Production Deployment

- Domain: `https://faultpact.bydx.fun` — **LIVE**.
- DNS: **PASS**; host resolved to the deployed server.
- HTTP: **PASS**; redirects to HTTPS.
- TLS: **PASS**; hostname-validated Let’s Encrypt certificate observed.
- Nginx: **PASS**; configuration test succeeded before reload.
- Landing: **PASS**.
- API: **PASS**.
- Docs: **PASS**.
- Evidence endpoint: **PASS**.

The production routing is `/` to web, `/api/` to the API, and `/evidence/` to
the immutable artifact route. Database and service credentials are not included
in this repository or report.

## Wallet E2E Environment

- Wallet: **MetaMask** official extension, version 13.49.0.0.
- Public test address: `0xD6bD92F526E849cA80a8019551Faa135bc61639B`.
- Private key: **not recorded**.
- Read-only balance check: wallet held test GEN.
- Target network configured in the extension: GenLayer Studio Dev, chain 61997,
  RPC `https://studio-dev.genlayer.com/api`.
- Browser setup: visible extension onboarding/import and visible custom-network
  configuration were performed in a protected temporary profile.

## Real Frontend Transaction E2E

**NOT COMPLETED — RELEASE BLOCKER.**

The deployed route `/app/purchase?pact=1` was opened with real indexed Pact data.
The visible `Connect wallet` control was clicked repeatedly. MetaMask injected
EIP-1193 and exposed the test account, but `eth_requestAccounts` produced no
usable confirmation/approval target in automated headed Chromium. Notification
targets appeared transiently or redirected to an empty notification route. The
same result occurred after foregrounding the production tab, closing stale
extension pages, using a fresh protected profile, and disabling default browser
arguments that could suppress extensions.

Therefore:

| Required proof | Result |
| --- | --- |
| Wallet popup/confirmation | **BLOCKED** |
| Frontend-initiated write | **NOT RUN** |
| Public transaction hash | **NONE** |
| GenLayer decision/finalization | **NOT RUN** |
| Indexer observed frontend write | **NOT RUN** |
| API observed frontend write | **NOT RUN** |
| Frontend reflected frontend write | **NOT RUN** |

This is reported as an automation/environment blocker, not silently converted
to a scripted success. Direct SDK, raw RPC, backend, and Node writes were not
used.

Challenge and credit-withdrawal writes were also not exercised because no safe
challengeable state or claimable credit was created without the central wallet
path.

## Evidence HTTP Verification

**PASS.** The immutable production response was fetched twice and hashed from
the exact HTTP bytes. The path SHA, body SHA, content type, ETag, and immutable
cache policy agreed.

## Tests

| Suite | Passed | Failed | Skipped | Result |
| --- | ---: | ---: | ---: | --- |
| TypeScript unit (`pnpm test`) | 59 | 0 | 0 | PASS |
| Phase 0.1 Python regressions | 38 | 0 | 0 | PASS |
| Frontend Playwright, serial | 7 | 0 | 0 | PASS |
| Root integration command | 0 | 2 | 0 | BLOCKED by RPC quota and shell DB env |
| Production build | — | — | — | PASS |
| Lint | — | — | — | PASS |
| Typecheck | — | — | — | PASS |
| Prisma validate/migrate deploy | — | — | — | PASS |

The 7 Playwright passes came from the correctly invoked serial runner. An
earlier wrapper invocation used the package script's argument separator
incorrectly and had one flaky docs-navigation failure; the direct serial run
passed all seven tests and is the recorded result.

## Performance

The production route smoke completed without browser console errors on the
verified routes. The frontend uses the existing Next production build and
lazy/controlled client behavior. A full statistically meaningful RUM baseline
was not claimed; this certification did not invent LCP, CLS, or INP numbers.

## Accessibility

The existing frontend review covered semantic controls, keyboard-visible focus,
mobile navigation, reduced-motion behavior, labelled forms, and responsive
layouts. No critical accessibility issue was observed in the checked routes.
A full external assistive-technology certification was not performed.

## Security

The final application review found no Critical or High application finding in
the inspected code paths. Specific checks included:

- admin/internal mutation routes remain protected or disabled without a token;
- monitoring target creation is not a public arbitrary-URL probe surface;
- SSRF restrictions, response limits, and redirect controls are present;
- evidence bytes are content-addressed and served without reserialization;
- raw evidence is not rendered as unsanitized HTML;
- user financial actions remain wallet-signed;
- reporter keys are optional environment-only and are not stored or logged;
- runtime configuration uses only the frozen address and chain 61997;
- `Number` is not used for onchain financial precision in the adapter/UI paths.

The missing wallet E2E and live schema quota are release blockers, not evidence
of a passed security gate.

## F-06

**ACCEPTED LIMITATION.** GenLayer external native GEN transfer failure semantics
cannot be represented as a guaranteed recoverable transfer by the application.
The UI and backend distinguish internal claimable FaultPact credit from a
completed external GEN transfer. The application does not auto-withdraw or tell
users that funds were received before the relevant final state.

## Remaining Limitations

1. Fresh live schema verification is unavailable until the Studio Dev RPC quota
   resets. The pinned historical schema remains 78/23/55/4, but this run records
   the live request as 429, not PASS.
2. Real browser wallet confirmation is blocked in the available automated
   MetaMask environment. No frontend write was falsely claimed.
3. `genvm-lint` is not installed in the current execution environment; lint and
   validate are **UNAVAILABLE**, while historical certification artifacts remain
   preserved.
4. F-06 remains the accepted runtime limitation described above.

## GitHub Publication

The public repository `https://github.com/0xbardia/faultpact` was independently
checked and found empty before publication. The unreleased candidate was pushed
to `main` without force-push:

- Commit: `f5b9e4e08075ac584bf4f7f319ec36e78aacd1ad`
- Branch: `main`
- Tag: **not created**
- GitHub release: **not created**

No `v1.0.0` tag or GitHub release is permitted while this certification is
partial.

## Release Artifacts

Public release-candidate materials are prepared under:

```text
docs/assets/screenshots/
docs/architecture/faultpact-system.mmd
docs/architecture/faultpact-system.svg
release/FaultPact-v1.0.0-submission/
```

The submission directory is explicitly labelled unreleased. It contains no
private key, environment file, wallet profile, database dump, or private log.
An optional public candidate archive was created at
`release/FaultPact-v1.0.0-candidate-submission.zip` with SHA-256
`c28d466998a7fb8da8507b86f7f095afd05d856a60b311cc5ad8161864a34787`.

## Final Status

**FAULTPACT V1 FINAL SYSTEM CERTIFICATION PARTIAL — RELEASE BLOCKED**
