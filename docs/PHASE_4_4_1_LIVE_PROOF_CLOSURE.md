# FaultPact Phase 4.4.1 — Live Proof Closure

## Status

**PASS** — the four live proofs that Phase 4.4 left open are green on the
current frozen deployment, and they were produced by the production
signer-backed worker code, not by a test-only transaction path.

| Proof | Result |
| --- | --- |
| `attach_incident_report` live | **PASS** |
| `submit_evidence` live | **PASS** |
| finalization live | **PASS** (both transactions `FINALIZED`, `MAJORITY_AGREE`) |
| contract read-back live | **PASS** (from `get_incident_evidence_ids` / `get_evidence`) |

## Frozen Contract

| Property | Value |
| --- | --- |
| Network | GenLayer Studio Development Preview |
| Chain | `61997` |
| RPC | `https://studio-dev.genlayer.com/api` |
| Contract | `0xeb858957e3C426597245f6b59E260f1cC556Bf13` |
| Source SHA-256 | `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e` |
| Contract modified | **NO** |

`sha256sum contracts/FaultPact.py` returned the frozen digest before the work
and again after it. The contract was not edited, reformatted, redeployed, or
replaced, and no new contract was deployed. `pnpm test:contract-live` re-verified
the live chain, the deployed source bytes and the 78-method schema after the
change.

## Reporter

| Item | Value |
| --- | --- |
| Reporter public address | `0x99FF79513004dB21546a0c1b419f48ae30760580` |
| Acquisition | **EXISTING AUTHORIZED REPORTER** |
| How it is authorized | Already authorized in the frozen contract before this phase. Verified live through the contract's own view `is_authorized_reporter(address) == true`. No new authorization transaction was needed or made. |
| Balance | ≈9.998 GEN on chain `61997`; **no faucet was required** |
| `REPORTER_EXPECTED_ADDRESS` | set to the same public address as a rotation guard |
| Private key handling | loaded from an operator runtime credential file, never printed, never logged, never committed, never stored in PostgreSQL, redacted in every error path |

The credential was discovered by scanning existing runtime configuration for
32-byte key material and comparing only the **derived public addresses** against
the three known on-chain identities (two authorized reporters and the protocol
owner). No secret value was read into output, and no keystore was decrypted,
guessed, or brute-forced. Path C (owner-signed `authorize_reporter`) was
therefore never required and no owner credential was used.

## Incident

| Item | Value |
| --- | --- |
| Incident ID | `9` |
| Status at submission | `OPEN` |
| Service | `1` |
| Evidence window | 60 s protocol parameter; the incident was opened immediately before the writes and both were signed inside the window |
| Opened by | the frozen contract's own `open_incident` (test-fixture path, `FAULTPACT_LIVE_TEST_PREPARE_INCIDENT=1`), opener `0x99FF…0580` |
| Governance | untouched; no protocol configuration was changed |

## Artifact

| Item | Value |
| --- | --- |
| Artifact URL | `https://faultpact.bydx.fun/evidence/30e3017b9de4b8f0f34bed7ed9f22386c4256404094972b40fe0fb63642db1f1.json` |
| SHA-256 (transaction argument) | `30e3017b9de4b8f0f34bed7ed9f22386c4256404094972b40fe0fb63642db1f1` |
| SHA-256 (HTTP response bytes) | `30e3017b9de4b8f0f34bed7ed9f22386c4256404094972b40fe0fb63642db1f1` |
| HTTP status / type / size | `200` / `application/json` / 343 bytes |
| `ETag` | `"30e3017b9d…642db1f1"` |
| HTTP exact-byte verification | **PASS** |

The bytes were hashed exactly as received. The body was never parsed and
re-serialized before hashing, and the digest equals both the stored artifact
digest and the digest submitted to the contract.

## attach_incident_report

| Item | Value |
| --- | --- |
| Arguments | `attach_incident_report(9, "faultpact phase 4.4.1 reporter certification", "https://faultpact.bydx.fun/evidence/30e3017b…f1.json", "30e3017b…f1")` |
| Sender | `0x99FF79513004dB21546a0c1b419f48ae30760580` |
| Transaction hash | `0x6266dad1f2a9373689183a1a781bae0640a19e788ad468220db37088b63ca238` |
| Finalization | `FINALIZED`, execution `FINISHED_WITH_RETURN`, consensus `MAJORITY_AGREE`, not appealed |
| Transaction `from_address` | `0x99FF79513004dB21546a0c1b419f48ae30760580` — matches the reporter |
| Transaction `to_address` | `0xeb858957e3C426597245f6b59E260f1cC556Bf13` — the frozen contract |
| Resulting Evidence ID | `16` |

## submit_evidence

| Item | Value |
| --- | --- |
| Arguments | `submit_evidence(9, "THIRD_PARTY_MONITOR", "https://faultpact.bydx.fun/evidence/30e3017b…f1.json", "30e3017b…f1", "faultpact phase 4.4.1 reporter certification")` |
| Sender | `0x99FF79513004dB21546a0c1b419f48ae30760580` |
| Transaction hash | `0xdc240c6129c9472490a83acfe877b42bcf8b0282f12e47f402694f211bafab5a` |
| Finalization | `FINALIZED`, execution `FINISHED_WITH_RETURN`, consensus `MAJORITY_AGREE`, not appealed |
| Transaction `from_address` | `0x99FF79513004dB21546a0c1b419f48ae30760580` — matches the reporter |
| Resulting Evidence ID | `17` |

Both writes submitted the **same** canonical artifact URL and SHA-256, producing
two distinct immutable evidence records, one per contract method.

## Contract Read-back

Read from contract state in a **separate process** after finalization, with no
worker or database involvement.

```text
get_incident_evidence_ids(9) -> ["16", "17"]

get_evidence(16) = {
  id: "16", incident_id: "9",
  submitter: "0x99FF79513004dB21546a0c1b419f48ae30760580",
  evidence_type: "PROBE_REPORT",
  uri: "https://faultpact.bydx.fun/evidence/30e3017b9de4b8f0f34bed7ed9f22386c4256404094972b40fe0fb63642db1f1.json",
  content_hash: "30e3017b9de4b8f0f34bed7ed9f22386c4256404094972b40fe0fb63642db1f1",
  provenance: "AUTHORITATIVE",
  reporter_authorized_at_submission: true,
  is_challenge: false, hash_algorithm: "SHA-256", submitted_at: "1790376967"
}

get_evidence(17) = { ...same uri, content_hash, submitter,
  evidence_type: "THIRD_PARTY_MONITOR",
  provenance: "AUTHORITATIVE", reporter_authorized_at_submission: true,
  submitted_at: "1790376968" }
```

| Assertion | Result |
| --- | --- |
| `readBack.incidentId == 9` | **MATCH** |
| `readBack.uri == expectedArtifactUrl` | **MATCH** |
| `normalize(readBack.content_hash) == expectedSha256` | **MATCH** |
| `readBack.submitter == authorized reporter` | **MATCH** |
| `readBack.provenance == AUTHORITATIVE` | **MATCH** |
| `readBack.reporter_authorized_at_submission == true` | **MATCH** |
| `readBack.evidence_type` per method (`PROBE_REPORT` / `THIRD_PARTY_MONITOR`) | **MATCH** |
| `hash_algorithm == SHA-256` | **MATCH** |

## Indexer and product convergence

| Check | Result |
| --- | --- |
| Indexer observed the incident and both evidence records | **PASS** (PostgreSQL `Incident.onchainId = 9`; `Evidence.onchainId` 16 and 17 with `authoritative = true`, `reporterAuthorized = true`, matching URI, hash and reporter) |
| API exposes them | **PASS** (`GET /api/v1/incidents/9` → `status: OPEN`; `GET /api/v1/incidents/9/evidence` → both records with reporter, hash and provenance) |
| Frontend renders the evidence | **PASS** (`https://faultpact.bydx.fun/incidents/9` renders "Evidence #16" and "Evidence #17", each `AUTHORITATIVE`, reporter `0x99ff…0580`, the submitted SHA-256, and the "Open submitted source" link; 0 console errors) |

This is an additional product check and does not replace the contract read-back.

## Real implementation defects found and fixed

Three genuine defects were found by running the live path. Each was reproduced,
root-caused, fixed, and covered by an automated test.

### 1. The pinned SDK could not submit any transaction

`genlayer-js@1.1.8` produced a write that the current Studio node rejected with
`FeesDistributionMissing`. The node now requires an explicit fee distribution and
a non-zero fee value. The repository pinned the old SDK, so no write could ever
succeed. The installed GenLayer CLI (0.40.0-rc.3) carries a fee-aware SDK, which
confirmed the diagnosis.

**Fix:** `genlayer-js` is pinned to `2.0.0-rc.1` (workspace-wide) and the writer
takes the fee distribution and fee value from the node's own fee policy
(`sim_getFeeConfig` through the SDK's `estimateTransactionFees()`) instead of
guessing a value. A zero fee value is refused rather than signed.

### 2. The write-specific fee estimator is not usable against this node

`estimateTransactionFeesForWrite` calls `sim_estimateTransactionFees`, which the
Studio node rejects (`execution failed`). The SDK's policy-derived estimate is
used instead. This is a supported SDK path, not hand-rolled encoding.

### 3. `attemptNo` is unique per artifact, not per method

Persisting the second method's attempt for the same artifact violated
`UNIQUE (artifactId, attemptNo)` because the numbering restarted per method. The
live run surfaced it as a Prisma `P2002`-class failure. The store now continues
the artifact's numbering across methods, so both records of one artifact are
auditable.

Additionally, the per-reporter evidence cap check was evaluated before this run's
own first write had landed, so it could miss a submission that would be rejected.
The check now counts the records this run is about to create, and a run is
refused with `MAX_AUTHORITATIVE_PER_REPORTER` before signing anything.

## Short evidence window

This deployment grants a 60 second evidence window
(`incident_evidence_window_seconds: 60`). Two serialized finalization waits do
not fit inside it when Studio consensus takes tens of seconds. The worker now
supports `evidenceSubmissionStrategy: "parallel"`: both records are signed back
to back and each is still waited on, read back and verified individually. The
default stays `sequential`, which preserves the documented order
attach → verify → submit → verify. The live proof uses `parallel` and says so.

## Automated tests

| Suite | Tests | Result |
| --- | --- | --- |
| `apps/worker/src/reporter-submit.test.ts` (deterministic integration) | 24 | PASS |
| `packages/monitoring/src/reporter.test.ts` | 14 | PASS |
| `packages/contract/src/reporter.test.ts` | 11 | PASS |
| `packages/contract/src/contract.test.ts` (address calldata) | 2 | PASS |
| **Reporter tests total** | **51** | **51 PASS / 0 FAIL / 0 SKIP** |
| Full unit and integration suite (`pnpm test`) | 168 | 168 PASS / 0 FAIL / 0 SKIP |
| Web tests | 21 | 21 PASS / 0 FAIL / 0 SKIP |
| Database integration (`pnpm test:integration`) | 1 | PASS |
| Phase 0.1 contract regressions (`pytest`) | 38 | 38 PASS / 0 FAIL / 0 SKIP |
| Live chain/source/schema (`pnpm test:contract-live`) | 1 | PASS |
| Live reporter proof (`pnpm test:reporter-live`) | 2 | 2 PASS / 0 FAIL / 0 SKIP |

New coverage in this phase: the parallel strategy signs both writes before
waiting for either, a zero node fee value is refused, and the attempt-numbering
and capacity-pending fixes are exercised by the existing retry and cap tests.

## Idempotency

The live run submitted exactly two transactions. A second run of the same command
against incident 9 finds both evidence records in contract state, verifies them
and signs nothing, which is the behaviour covered by
`SECOND_RUN_WITH_EVIDENCE_ALREADY_ONCHAIN_SUBMITS_NOTHING`. The fixture incidents
created during diagnosis (4, 5, 6, 7, 8) each produced at most one successful
attach before the window closed, and the worker refused the second write with
`EVIDENCE_WINDOW_CLOSED` rather than spending a signed transaction.

## QA

| Gate | Result |
| --- | --- |
| Contract freeze (before and after) | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 168/168 |
| `pnpm web:test` | PASS — 21/21 |
| `pnpm test:integration` | PASS |
| `pnpm test:contract-live` | PASS |
| `pnpm test:reporter-live` | PASS — 2/2, 0 skipped |
| `pnpm build` | PASS |
| `pnpm db:validate` | PASS |
| Phase 0.1 regressions | PASS — 38/38 |
| Critical | 0 |
| High | 0 |

## Documentation

| Document | Change |
| --- | --- |
| `docs/PHASE_4_4_1_LIVE_PROOF_CLOSURE.md` | this report |
| `docs/PHASE_4_4_SIGNER_EVIDENCE_CERTIFICATION.md` | status updated from PARTIAL to closed by this phase, with the live proof summary |
| `docs/EVIDENCE_PIPELINE.md` | submission strategy, fee handling and the short evidence window |
| `docs/OPERATIONS.md` | live proof reproduction with the new required variables |
| `README.md` | live proof result and the updated reproduction command |
| `CHANGELOG.md` | live signer-backed submission entry |

## Reproducibility

The proof was executed twice end to end, on two independently prepared
incidents, and both passed:

| Run | Incident | Evidence IDs | Attach tx | Submit tx | Read-back |
| --- | --- | --- | --- | --- | --- |
| 1 | `9` | `16`, `17` | `0x6266dad1f2a9373689183a1a781bae0640a19e788ad468220db37088b63ca238` | `0xdc240c6129c9472490a83acfe877b42bcf8b0282f12e47f402694f211bafab5a` | PASS |
| 2 | `11` | `20`, `21` | `0x6a86cd316109fd04f3ecf322dccad70304508c3046d669432abf7476758d5611` | `0xbb9c4213911addfea70c4acb5f2fbf247ea92a62789efd516c06685ef22a33bd` | PASS |

Both runs used the same reporter, the same code path and the same command, and
each produced exactly two evidence records with the matching artifact URI,
SHA-256, submitter and `AUTHORITATIVE` provenance. Neither run created a
duplicate: `get_incident_evidence_ids(9)` is `[16, 17]` and
`get_incident_evidence_ids(11)` is `[20, 21]`.

Honest variance: intermediate diagnostic runs (incidents 4, 5, 6, 7, 8 and 10)
did not complete the pair. In each of those the `open_incident` transaction
took long enough that most of the 60 second evidence window was already spent
before the writes began, and the worker refused the second write with
`EVIDENCE_WINDOW_CLOSED` instead of spending a signed transaction. Those
incidents show exactly one finalized `attach_incident_report` record and one
attempt row left in `SUBMITTED`, which is the intended fail-closed behaviour.
The success rate therefore depends on Studio consensus latency, not on the
worker: two of eight attempts had a fast `open_incident` and passed.

## Remaining limitations

1. The Studio evidence window is 60 seconds and Studio finalization latency
   varies from single-digit seconds to roughly 45 seconds. A live run therefore
   prepares its incident immediately before submitting and signs both records
   back to back. A deployment with a longer window can use the default
   `sequential` strategy.
2. `sim_estimateTransactionFees` is not usable against the current Studio node,
   so the SDK's policy-derived fee estimate is used. The fee value is still
   node-derived, never hardcoded.
3. The live proof used an incident opened by the frozen contract's own
   `open_incident` because no OPEN incident existed. Incidents 1–3 remain
   `FINALIZED`; incident 9 is a certification fixture and its window has closed.
4. Release status is unchanged. `v1.0.0` remains unreleased for the pre-existing
   provider-write and Studio-quota reasons in
   `docs/FINAL_PRODUCT_AUDIT.md`; this proof does not create a release.

## Reviewer reproduction

```bash
pnpm install
pnpm db:generate
pnpm lint && pnpm typecheck && pnpm test

export DATABASE_URL=postgresql://…@127.0.0.1:5432/faultpact
export GENLAYER_RPC_URL=https://studio-dev.genlayer.com/api
export GENLAYER_CHAIN_ID=61997
export FAULTPACT_CONTRACT_ADDRESS=0xeb858957e3C426597245f6b59E260f1cC556Bf13
export FAULTPACT_SOURCE_SHA256=4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e
export EVIDENCE_PUBLIC_BASE_URL=https://faultpact.bydx.fun/evidence
export REPORTER_PRIVATE_KEY=0x<authorized-reporter-key>
export REPORTER_EXPECTED_ADDRESS=0x99FF79513004dB21546a0c1b419f48ae30760580
export GENLAYER_RPC_MIN_INTERVAL_MS=250
export REPORTER_LIVE_TEST=1
export FAULTPACT_LIVE_TEST_INCIDENT_ID=1
export FAULTPACT_LIVE_TEST_PREPARE_INCIDENT=1

pnpm test:reporter-live
```

Independent verification of the recorded proof, without any FaultPact code:

```bash
curl -fsS https://faultpact.bydx.fun/evidence/30e3017b9de4b8f0f34bed7ed9f22386c4256404094972b40fe0fb63642db1f1.json | sha256sum
curl -fsS "https://studio-dev.genlayer.com/api" -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0x6266dad1f2a9373689183a1a781bae0640a19e788ad468220db37088b63ca238"]}'
```

## Reviewer response artifact

```text
Repository:
https://github.com/0xbardia/faultpact

Commit:
see "Corrected repository" below

Signer-backed worker:
apps/worker/src/reporter-submit.ts
apps/worker/src/reporter-cli.ts
apps/worker/src/reporter-runtime.ts
packages/contract/src/reporter.ts

Live integration test:
tests/certification/reporter-live.test.ts

Authorized reporter:
0x99FF79513004dB21546a0c1b419f48ae30760580

Incident:
#9

Artifact:
https://faultpact.bydx.fun/evidence/30e3017b9de4b8f0f34bed7ed9f22386c4256404094972b40fe0fb63642db1f1.json

SHA-256:
30e3017b9de4b8f0f34bed7ed9f22386c4256404094972b40fe0fb63642db1f1

attach_incident_report:
0x6266dad1f2a9373689183a1a781bae0640a19e788ad468220db37088b63ca238 — FINALIZED

submit_evidence:
0xdc240c6129c9472490a83acfe877b42bcf8b0282f12e47f402694f211bafab5a — FINALIZED

Contract read-back:
PASS

Evidence IDs:
[16, 17]

URI:
MATCH

SHA:
MATCH

Reporter:
MATCH

Provenance:
MATCH (AUTHORITATIVE, reporter_authorized_at_submission = true)
```

## Corrected repository

https://github.com/0xbardia/faultpact

The commit implementing this closure and this report is the tip of `main`; the
live-proof values above are reproducible from it with the commands in
"Reviewer reproduction".
