# FaultPact Phase 4.4 — Signer-backed Evidence Certification

## Status

**PARTIAL**

The signer-backed worker path, the runnable command, the deterministic
integration coverage, the configuration model and the documentation are complete
and verified. The live Studio Dev submission proof could not be executed because
this environment has **no funded, contract-authorized reporter private key**.
Every remaining item is a single external credential, not missing code. Per the
definition of done, this phase is **not** a PASS.

Live items that are proven: chain `61997`, frozen contract address, frozen
source digest, reporter public-address derivation, reporter authorization
preflight against the final contract model (both positive and negative), public
artifact HTTP byte/hash verification, and fail-closed command behaviour with a
real signer against the real chain.

Live items that are **not** proven: `attach_incident_report` finalization,
`submit_evidence` finalization, and the resulting contract read-back. No mock,
cache, or database row is presented as any of them.

## Frozen Contract

| Property | Value |
| --- | --- |
| Network | GenLayer Studio Development Preview |
| Chain | `61997` |
| RPC | `https://studio-dev.genlayer.com/api` |
| Contract | `0xeb858957e3C426597245f6b59E260f1cC556Bf13` |
| Source | `contracts/FaultPact.py` |
| Source SHA-256 | `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e` |
| Contract modified | **NO** |

`sha256sum contracts/FaultPact.py` returned the frozen digest at the start of
this phase and again at the end. The contract was not edited, reformatted,
re-deployed, or replaced. No replacement contract was created. Schema
fingerprint, method counts (78 methods, 23 views, 55 writes, 4 payable) and the
deployed source bytes are unchanged and re-verified against the live chain.

## Implementation

### Worker path

| Concern | File |
| --- | --- |
| Orchestration (the flow the reviewer asked for) | `apps/worker/src/reporter-submit.ts` |
| Production wiring (adapter, signer, DB ports) | `apps/worker/src/reporter-runtime.ts` |
| Runnable command | `apps/worker/src/reporter-cli.ts` |
| PASS/FAIL operator report | `apps/worker/src/reporter-summary.ts` |
| Signer, key handling, SDK client | `packages/contract/src/reporter.ts` |
| Loopback RPC bridge (single scheduler for all traffic) | `packages/contract/src/bridge.ts` |
| Transaction lifecycle and bounded finalization | `packages/contract/src/transactions.ts` |
| Argument construction, artifact verification, read-back, retry planning | `packages/monitoring/src/reporter.ts` |
| Frozen evidence-type vocabulary | `packages/shared/src/index.ts` |

Flow, exactly as implemented:

```
generated monitoring evidence
  -> canonical immutable bytes (faultpact-probe-v1, sorted keys, no floats)
  -> SHA-256 over those exact bytes
  -> public immutable artifact URL (EVIDENCE_PUBLIC_BASE_URL/<sha>.json)
  -> HTTP fetch of the public URL, hash of the exact response bytes
  -> authorized reporter preflight (chain, frozen source, frozen address, is_authorized_reporter)
  -> current incident evidence ids from contract state
  -> attach_incident_report -> wait for FINALIZED -> get_incident_evidence_ids + get_evidence
  -> submit_evidence       -> wait for FINALIZED -> get_incident_evidence_ids + get_evidence
  -> persist proof (EvidenceSubmissionAttempt)
```

A transaction is never treated as success on submission. An expired finalization
wait is reported as `NOT VERIFIED`, not as a pass.

### Runnable command

```bash
pnpm evidence:submit --incident-id <open-incident-id> [--dry-run] [--json]
pnpm evidence:submit --incident-id <id> --summary "…" --description "…" --evidence-type THIRD_PARTY_MONITOR
```

The command resolves or generates the intended artifact, loads the exact
immutable bytes, computes and verifies the SHA-256, constructs the public URL,
preflights reporter authorization, calls `attach_incident_report`, waits for
finalization, calls `submit_evidence`, waits for finalization, reads the
resulting evidence from contract state, verifies it, and prints a concise
PASS/FAIL summary. Exit codes: `0` verified, `1` a step failed, `2` the command
could not run.

### Contract adapter changes

* `FaultPactContractAdapter` gained `transport`, `getIncident`,
  `getIncidentEvidenceIds`, `getEvidence` and `verifyFrozenTarget`. `write()`
  still refuses to sign and now points at `createReporterWriter`.
* **Bug fix required by this phase:** the legacy read calldata encoder could not
  express `address`-typed parameters, so `is_authorized_reporter` (and every
  other address-typed view, including `get_claimable_balance`) failed against the
  live node with `RLP string ends with 290 superfluous bytes`. The encoder now
  emits the GenLayer address value (20 raw bytes after the address marker) and
  the adapter maps address-typed parameters from the frozen schema. This was
  never exercised in production because the reporter path had no signer. Fixed
  in `packages/contract/src/rpc.ts` and `packages/contract/src/index.ts`; the
  contract itself was not touched.

### Persistence / idempotency changes

Migration `0004_reporter_evidence_submission` extends the existing
`EvidenceSubmissionAttempt` model (no new table) with `method`, `artifactUrl`,
`artifactSha256`, `evidenceId`, `txState`, `finalizedAt` and `failureCategory`,
plus lookup indexes and a partial unique index that allows at most one unresolved
attempt per artifact and contract method.

Before a retry the worker:

1. reads `get_incident_evidence_ids` and every record from contract state;
2. skips a write whose evidence already exists with the same URI, hash, submitter
   and evidence type (`ALREADY_ONCHAIN`, still read-back verified);
3. reconciles an unresolved prior transaction instead of resubmitting
   (`RECONCILED`);
4. re-checks the incident status, the evidence window and the frozen per-reporter
   evidence cap before the second write;
5. only signs when the plan says `SUBMIT`.

The reporter private key is never written to PostgreSQL, returned by the API,
logged, or included in an exception. Only the derived public address is
persisted and reported.

## Authorized Reporter

| Item | Value |
| --- | --- |
| Configured reporter public address (this run) | `0x8C58118a6437097bD776063b41880995a38759b7` (throwaway key used to prove fail-closed behaviour) |
| Authorized reporters on chain 61997 | `0x99FF79513004dB21546a0c1b419f48ae30760580`, `0x870C3e1f3059ce369dA57B12431212aD6Cf84073` |
| Authorization verification | `is_authorized_reporter(address)` against the frozen contract |
| Private key handling | never printed, logged, stored, or returned; `<redacted>` in every error path |

Configuration model:

| Variable | Required | Meaning |
| --- | --- | --- |
| `REPORTER_PRIVATE_KEY` | no | Enables signer-backed submission. Absent ⇒ MONITOR-ONLY and `REPORTER SUBMISSION DISABLED`. |
| `REPORTER_EXPECTED_ADDRESS` | no | Rotation guard. When set, the key must derive exactly this address or the worker refuses to sign. |
| `GENLAYER_RPC_URL` / `GENLAYER_CHAIN_ID` | yes | Pinned to the frozen Studio Dev endpoint and chain `61997`; anything else is refused. |
| `FAULTPACT_CONTRACT_ADDRESS` / `FAULTPACT_SOURCE_SHA256` | yes | Pinned to the frozen deployment; the deployed source bytes are re-read and compared before signing. |
| `EVIDENCE_PUBLIC_BASE_URL` | yes | Public, HTTPS-reachable base for immutable artifacts. |
| `REPORTER_SUBMIT_EVIDENCE_TYPE` | no | `submit_evidence` type, default `THIRD_PARTY_MONITOR`. |
| `FAULTPACT_LIVE_TEST_INCIDENT_ID` | no | OPEN incident used by the command and the live test. |
| `REPORTER_MAX_FINALIZATION_WAIT_MS` | no | Bounded finalization wait, default `240000`. |

Authorization is never inferred from key presence. A key that derives an
unauthorized address produces `REPORTER_NOT_AUTHORIZED` and signs nothing; this
was verified against the live chain.

## Artifact

Live verification of the existing immutable artifact pipeline (this is the same
path the reporter uses):

| Item | Value |
| --- | --- |
| Artifact URL | `https://faultpact.bydx.fun/evidence/b8666d22c75efdbbd43ff2047914cb749ebe891f89427598d07ebd35bba95b03.json` |
| SHA-256 (stored) | `b8666d22c75efdbbd43ff2047914cb749ebe891f89427598d07ebd35bba95b03` |
| SHA-256 (HTTP response bytes) | `b8666d22c75efdbbd43ff2047914cb749ebe891f89427598d07ebd35bba95b03` |
| Size | 337 bytes |
| `Content-Type` | `application/json` |
| `Cache-Control` | `public, immutable, max-age=31536000` |
| `ETag` | `"b8666d22…"` |
| HTTP byte/hash verification | **PASS** |

For a live submission the worker generates a *fresh* canonical artifact for the
incident window, stores it through the same immutable repository, fetches the
public URL over HTTPS, and hashes the exact response bytes. Status, content
type, declared length, size bound and digest are all checked; any difference is
fatal and no transaction is signed. The body is never parsed and re-serialized.

## attach_incident_report

**NOT VERIFIED — blocked on the authorized reporter key.**

| Item | Value |
| --- | --- |
| Arguments | `attach_incident_report(incident_id, summary, evidence_uri, evidence_hash)` |
| Argument order | asserted against the frozen schema snapshot before signing |
| Sender | not submitted |
| Tx hash | none |
| Finalization | none |
| Resulting evidence ID | none |

## submit_evidence

**NOT VERIFIED — blocked on the authorized reporter key.**

| Item | Value |
| --- | --- |
| Arguments | `submit_evidence(incident_id, evidence_type, evidence_uri, content_hash, description)` |
| Evidence type | `THIRD_PARTY_MONITOR` (default) |
| Sender | not submitted |
| Tx hash | none |
| Finalization | none |
| Resulting evidence ID | none |

Both methods are exercised by the same command with the same canonical artifact
URL and SHA-256, producing two distinct evidence records. That is the minimum
correct relationship: the frozen contract has no duplicate-submission guard, and
its evidence caps are counted per provenance per submitter, so reusing one
artifact across the two methods is safe and is what the reviewer asked to see.

## Contract Read-back

**NOT VERIFIED — blocked on the authorized reporter key.**

The deterministic integration test proves the read-back path end to end against a
faithful model of the frozen contract (real frozen schema, real legacy read
calldata, real evidence semantics, real GenLayer transaction states):
`incident_id`, `uri`, `content_hash`, `submitter`, `evidence_type`, `provenance`,
`reporter_authorized_at_submission` and `hash_algorithm` are all asserted, and a
mismatched URI, hash, submitter or provenance fails the step. The live proof
reads the same fields from `get_incident_evidence_ids` and `get_evidence`;
database rows are never substituted.

Sender proof: the `Evidence.submitter` field carries the transaction signer, and
`reporter_authorized_at_submission` records the authorization state the contract
evaluated at submission time. Independently of the read-back, the worker compares
the transaction `from_address` returned by `eth_getTransactionByHash` with the
configured reporter address and fails on any difference.

## Automated Tests

### A. Deterministic integration (no live Studio state)

| Suite | Tests | Result |
| --- | --- | --- |
| `apps/worker/src/reporter-submit.test.ts` | 23 | PASS |
| `packages/monitoring/src/reporter.test.ts` | 14 | PASS |
| `packages/contract/src/reporter.test.ts` | 11 | PASS |
| `packages/contract/src/contract.test.ts` (address encoding) | 2 | PASS |
| **Phase 4.4 total** | **50** | **50 PASS / 0 FAIL** |

Coverage: canonical artifact bytes and public URL construction, SHA-256 over
exact bytes, reporter address derivation, authorization preflight (authorized,
unauthorized, missing key, expected-address mismatch), exact contract argument
construction validated against the frozen schema by name and position, sender
selection and sender-mismatch detection, transaction lifecycle mapping, bounded
finalization polling, finalization timeout reported as not verified, reverted
transactions, idempotent retry after a restart (reconcile, no duplicate write),
already-onchain skip, read-back parsing with bigint precision, and URI, hash,
type, provenance and incident mismatch failures. A frozen source digest check
runs against the real `contracts/FaultPact.py`.

The fakes are adapters, not string inspections: the real contract adapter, the
real schema snapshot, the real legacy read calldata, the real monitoring rules,
the real transaction tracker and the real summary formatter are all exercised.

### B. Live Studio Dev integration

| Command | Result |
| --- | --- |
| `pnpm test:reporter-live` without `REPORTER_LIVE_TEST` | **NOT CONFIGURED** (suite skipped, no Studio state changed) |
| `pnpm test:reporter-live` with `REPORTER_LIVE_TEST=1` and an unauthorized key | **FAIL — `REPORTER_NOT_AUTHORIZED`** (chain, frozen source and incident reads succeeded first; nothing was signed) |
| `pnpm test:reporter-live` with an authorized funded key | **NOT RUN — no such key exists in this environment** |

The live suite performs the full sequence when configured: derive the address,
verify `61997`, verify the frozen deployment, verify reporter authorization,
load the configured OPEN incident, generate a fresh canonical artifact, expose it
through the normal immutable pipeline, fetch the public bytes, recompute the
SHA-256, call `attach_incident_report`, wait for `FINALIZED`, call
`submit_evidence`, wait for `FINALIZED`, read the incident evidence ids, read
the evidence records, and assert URL, hash, sender and provenance. It is never
part of ordinary unit CI, and a missing credential is never reported as a pass.

`FAULTPACT_LIVE_TEST_PREPARE_INCIDENT=1` opens a fresh incident with the frozen
contract's own `open_incident` (existing contract functionality, no governance
change, no opener evidence slot consumed) when no suitable incident is supplied.

## Idempotency / Retry

* Every write is persisted before it is signed (`SUBMITTED`) and after it decides
  (`FINALIZED` / `FAILED`), with incident, artifact SHA-256, artifact URL,
  method, reporter public address, tx hash, tx state, resulting evidence id,
  finalized timestamp and failure category.
* A crashed worker reconciles the unresolved transaction on the next run instead
  of submitting again. Deterministic proof: `RETRY_AFTER_TIMEOUT_RECONCILES_INSTEAD_OF_DUPLICATING`.
* A second run against an incident that already holds the evidence signs nothing:
  `SECOND_RUN_WITH_EVIDENCE_ALREADY_ONCHAIN_SUBMITS_NOTHING`.
* A partial unique index blocks two unresolved attempts for the same artifact and
  method at the database level.
* Finalization polling is bounded with exponential backoff; HTTP 429,
  `Retry-After` and temporary RPC failures extend the backoff. Exhausted bounds
  are reported, never hidden.

## QA

| Gate | Command | Result |
| --- | --- | --- |
| Contract freeze | `sha256sum contracts/FaultPact.py` | PASS — `4913a2af…bb2e` before and after |
| Lint | `eslint . --max-warnings 0` | PASS |
| Typecheck | `tsc -b` + `tsc --noEmit` (web) | PASS |
| Unit + integration tests | `vitest run` | PASS — 167 tests, 13 files, 0 skipped |
| Worker / evidence suites | included above | PASS — 50 Phase 4.4 tests |
| Web tests | `vitest run --config apps/web/vitest.config.ts` | PASS — 21 tests |
| Database integration | `node scripts/test-integration.mjs` | PASS — migration deploy + integration test |
| Prisma validation | `prisma validate` | PASS |
| Prisma migration | `prisma migrate deploy` (test and live databases) | PASS |
| Production build | `tsc -b` + `next build` | PASS |
| Phase 0.1 contract regressions | `pytest tests/test_phase_0_1_hardening.py` | PASS — 38 tests |
| Live contract regression | `pnpm test:contract-live` | PASS — chain, source digest, schema, 78 methods |
| Live reporter proof | `pnpm test:reporter-live` | **NOT CONFIGURED / FAIL on authorization gate** |

Two unrelated reliability fixes were needed to run these gates in this
environment and are included in this phase:

1. `pnpm test:contract-live` selected a file that the default Vitest config
   excludes, so it exited with "No test files found". It now uses
   `vitest.certification.config.ts`.
2. The default Vitest timeout of 5 s made the pre-existing, unrelated
   `API_HEALTH` test fail intermittently under parallel load on this runner. The
   timeout is now 20 s. No assertion was changed or relaxed.

Inspection checklist: private-key leakage (redaction in the signer, no key in
logs, output, database or exceptions; asserted by tests), duplicate submission
(plan, partial unique index, tests), URL normalization (exact string equality
with the constructed URL, HTTPS only), SHA normalization (optional `0x`, case
insensitive, malformed digests fail closed), BigInt serialization (decimal
strings in PostgreSQL, `jsonSafe` in JSON, `2^70` precision test), unbounded
retry (bounded tracker, transport budget and cooldown), RPC retry storms (all
signer traffic proxied through the shared transport), transaction state races
(state is only trusted after finalization), stale incident state (incident
re-read before the second write), closed evidence windows (deadline checked
before each write), wrong-chain fallback (local and RPC chain checks, frozen RPC
URL pinned in the signer).

## Documentation

| Document | Change |
| --- | --- |
| [`README.md`](README.md) | New discoverable "Signer-backed Evidence Worker" section linking the worker, the live test, the evidence pipeline, the reporter setup and this report |
| [`docs/EVIDENCE_PIPELINE.md`](EVIDENCE_PIPELINE.md) | Signer-backed submission flow, contract arguments, artifact verification, finalization, read-back and retry safety |
| [`docs/MONITORING.md`](MONITORING.md) | MONITOR-ONLY vs AUTHORIZED REPORTER SUBMISSION, preflight states, the explicit command |
| [`docs/OPERATIONS.md`](OPERATIONS.md) | Ten-step "Authorized Reporter Setup" including minimum operational permissions |
| [`.env.example`](.env.example) | `REPORTER_EXPECTED_ADDRESS`, `REPORTER_SUBMIT_EVIDENCE_TYPE`, `REPORTER_MAX_FINALIZATION_WAIT_MS`, `FAULTPACT_LIVE_TEST_INCIDENT_ID` |
| [`CHANGELOG.md`](CHANGELOG.md) | Unreleased entry for this phase |

## Remaining Limitations

1. **No live submission proof.** The environment has no funded,
   contract-authorized `REPORTER_PRIVATE_KEY`. The two authorized reporter
   addresses exist on chain `61997`, but their keys are only present as encrypted
   GenLayer keystores (`~/.genlayer/keystores/faultpact-reporter-01.json`,
   `-02.json`) and the protocol-owner key required to authorize a *new* reporter
   is encrypted as well. Credentials were not guessed, cracked, or invented.
2. **No OPEN incident exists on chain `61997`.** Incidents `1`, `2` and `3` are
   all `FINALIZED`, so their evidence windows are closed. The live run needs
   `FAULTPACT_LIVE_TEST_INCIDENT_ID` pointing at an OPEN incident, or
   `FAULTPACT_LIVE_TEST_PREPARE_INCIDENT=1` with a funded signer.
3. **The Studio evidence window is 60 seconds** on this deployment
   (`incident_evidence_window_seconds: 60`). Both writes must be submitted inside
   that window, so a live run should prepare its incident immediately before
   submitting. The worker re-checks the window before the second write and stops
   with `EVIDENCE_WINDOW_CLOSED` rather than wasting a signed transaction.
4. `pnpm` cannot run in this sandbox (the repository pins pnpm 11, which requires
   Node 22.13; the host has Node 20.20.2), so the equivalent `npx`/`node`/`tsc`
   invocations were used for every gate above. The `package.json` scripts are
   unchanged and are what a Node 22 host runs.
5. Release status is unchanged: `v1.0.0` remains unreleased for the pre-existing
   provider-write and Studio-quota reasons recorded in
   [`docs/FINAL_PRODUCT_AUDIT.md`](FINAL_PRODUCT_AUDIT.md). This phase does not
   create a release.

## Reviewer Reproduction

Deterministic suite (no live credentials, no Studio state):

```bash
pnpm install
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
node scripts/test-integration.mjs          # requires TEST_DATABASE_URL ending in _test
python3 -m pytest tests/test_phase_0_1_hardening.py
```

Live contract regression (read-only):

```bash
pnpm test:contract-live
```

Signer-backed evidence command, against a real authorized reporter:

```bash
export DATABASE_URL=postgresql://faultpact:…@127.0.0.1:5432/faultpact
export GENLAYER_RPC_URL=https://studio-dev.genlayer.com/api
export GENLAYER_CHAIN_ID=61997
export FAULTPACT_CONTRACT_ADDRESS=0xeb858957e3C426597245f6b59E260f1cC556Bf13
export FAULTPACT_SOURCE_SHA256=4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e
export EVIDENCE_PUBLIC_BASE_URL=https://faultpact.bydx.fun/evidence
export REPORTER_PRIVATE_KEY=0x<authorized-reporter-key>
export REPORTER_EXPECTED_ADDRESS=0x<expected-public-address>
export FAULTPACT_LIVE_TEST_INCIDENT_ID=<open-incident-id>

pnpm evidence:submit --incident-id $FAULTPACT_LIVE_TEST_INCIDENT_ID --dry-run
pnpm evidence:submit --incident-id $FAULTPACT_LIVE_TEST_INCIDENT_ID
```

Expected output shape:

```text
Reporter: 0x…
Incident: 12
Artifact URL: https://faultpact.bydx.fun/evidence/<sha>.json
SHA-256: <sha>
HTTP byte/hash verification: PASS (sha256 <sha>, application/json)
Attach tx: 0x…
Attach finalization: PASS
Submit tx: 0x…
Submit finalization: PASS
Evidence IDs: …
Contract read-back: PASS
Verification: PASS
```

Live integration test:

```bash
REPORTER_LIVE_TEST=1 \
REPORTER_PRIVATE_KEY=0x<authorized-reporter-key> \
FAULTPACT_LIVE_TEST_INCIDENT_ID=<open-incident-id> \
pnpm test:reporter-live
```

Without `REPORTER_LIVE_TEST=1` the suite prints
`FAULTPACT REPORTER LIVE PROOF: NOT CONFIGURED` and changes nothing.

Independent verification of a completed run:

```bash
curl -fsS https://faultpact.bydx.fun/evidence/<sha>.json | sha256sum
curl -fsS https://faultpact.bydx.fun/api/v1/incidents/<id>/evidence
```

## Corrected Repository

https://github.com/0xbardia/faultpact

Implementation commit: `c19891d` — `feat(worker): signer-backed evidence
submission through the frozen contract`.

It adds `apps/worker/src/reporter-submit.ts`,
`apps/worker/src/reporter-cli.ts`, `apps/worker/src/reporter-runtime.ts`,
`packages/contract/src/reporter.ts`, `packages/monitoring/src/reporter.ts` and
`tests/certification/reporter-live.test.ts`, and updates
`docs/EVIDENCE_PIPELINE.md`, `docs/MONITORING.md`, `docs/OPERATIONS.md`,
`README.md` and `.env.example`. The commit immediately before it (`59a978b`)
publishes the earlier uncommitted indexer, monitoring, API and web work so the
repository is reviewable on its own.
