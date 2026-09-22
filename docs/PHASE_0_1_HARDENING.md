# FaultPact V1 Phase 0.1 Hardening

This report covers contract hardening only. No frontend, backend, indexer, monitoring application, website, or API server was added.

## Starting Source

- Original source: `contracts/FaultPact.py`
- Starting SHA-256: `dcdcec387a5c42687898f1484ce6455dfd346579010e64270919e845d145386f`
- Required starting SHA-256: `dcdcec387a5c42687898f1484ce6455dfd346579010e64270919e845d145386f`
- Immutable backup: `backups/FaultPact-pre-phase-0.1-20260921T130154Z.py`
- Backup SHA-256: `dcdcec387a5c42687898f1484ce6455dfd346579010e64270919e845d145386f`
- Historical pre-hardening deployment: `0xE3A4BCA106Fe0021c9fb664F73ef5F2FB1c0c3fd`
- Historical network: GenLayer Studio Development Preview, chain `61997`

The source-integrity gate passed before modification. The old deployment remains reference-only.

## Audit Findings

### F-01 — Evidence provenance and arbitrary evidence as financial truth

- Original issue: Any submitter could supply hash-valid content and two model executions could treat it as payout-bearing evidence. Hash equality did not authenticate the producer or establish measurement truth.
- Root cause: Evidence had no authenticated reporter registry, no provenance snapshot, no unique-reporter quorum, and no structured authoritative measurement schema.
- Code change: Added owner-controlled `authorized_reporters`, submission-time provenance snapshots, separate authoritative/supplemental classes, configurable `min_authoritative_reporters`, unique reporter counting, strict `faultpact-probe-v1` validation, and deterministic fact-to-evidence support binding. Scope and metrics are derived/checked against accepted structured authoritative evidence.
- Regression test: `F01_ARBITRARY_USER_EVIDENCE_CANNOT_ALONE_TRIGGER_PAYOUT`, `F01_ONLY_AUTHORIZED_REPORTER_COUNTS_AS_AUTHORITATIVE`, `F01_UNIQUE_REPORTER_QUORUM`, `F01_FACT_SUPPORT_IDS_REQUIRED`, `F01_HALLUCINATED_SUPPORT_ID_REJECTED`, `F09_SCOPE_DERIVED_FROM_AUTHORITATIVE_EVIDENCE`.
- Live verification: Reporters `0x99FF79513004dB21546a0c1b419f48ae30760580` and `0x870C3e1f3059ce369dA57B12431212aD6Cf84073` were authorized. Evidence `1` and `2` were submitted by those distinct reporters. Supplemental/invalid evidence could not support the finalized facts; the finalized resolution used p95 support `[1, 2]`. A supplemental-only incident terminated as `INCONCLUSIVE` with an ineligible claim.
- Status: **FIXED**

### F-02 — Failed evidence content entering the adjudication prompt

- Original issue: Hash-mismatched or failed fetches were marked unusable but their body/description could still enter the model prompt.
- Root cause: Fetch status was applied after content had already been assembled as factual input.
- Code change: `_fetch_one_evidence` returns empty content on fetch/hash/schema failure. Adjudication receives only fixed status tokens for failed, mismatched, or unselected evidence. Valid authoritative evidence is represented as structured data; supplemental content is explicitly untrusted and never satisfies fact support. Post-adjudication validation rejects invalid support IDs and invalid support records.
- Regression test: `F02_HASH_MISMATCH_BODY_NOT_IN_PROMPT`, `F02_FAILED_DESCRIPTION_NOT_FACT_INPUT`, `F02_INVALID_EVIDENCE_CANNOT_SUPPORT_METRIC`.
- Live verification: Evidence `3` was submitted with a hash for different bytes and evidence `4` pointed at HTTP 503. The real finalized resolution reported `usable_evidence_ids=[1,2]`, `unusable_evidence_ids=[3,4]`, and fact support only `[1,2]`.
- Status: **FIXED**

### F-03 — Approximate financial time consensus

- Original issue: A 300-second tolerance could accept different incident boundaries and therefore change coverage overlap or minimum-duration eligibility.
- Root cause: Financial interval fields were compared with a nonzero tolerance and duration could be independently model-authored.
- Code change: Financial `incident_start` and `incident_end` require exact leader/validator equality. The contract derives `duration_seconds = incident_end - incident_start`, checks ordering, bounds the interval to the Incident observation window, and does not accept an independent model duration.
- Regression test: `F03_EXACT_TIME_CONSENSUS_REQUIRED`, `F03_DURATION_DERIVED_FROM_INTERVAL`, `F03_COVERAGE_BOUNDARY_DISAGREEMENT_REJECTED`.
- Live verification: The real resolution finalized the exact interval `1790003620..1790003630` and stored duration `10`, equal to the deterministic subtraction. The deployed comparator is the hardened exact comparator; deliberate disagreement rejection is covered by the local current-SDK test.
- Status: **FIXED**

### F-04 — Evidence/resource exhaustion

- Original issue: A single aggregate evidence limit allowed supplemental/Sybil submissions to consume the incident budget and allowed excessive prompt/fetch work.
- Root cause: No separate provenance budgets, per-submitter limits, deterministic selection, or prompt/body limits.
- Code change: Added `MAX_AUTHORITATIVE_EVIDENCE=8`, `MAX_SUPPLEMENTAL_EVIDENCE=24`, `MAX_AUTHORITATIVE_PER_REPORTER=4`, `MAX_SUPPLEMENTAL_PER_SUBMITTER=4`, `MAX_SUPPLEMENTAL_FOR_ADJUDICATION=4`, `MAX_PROMPT_EVIDENCE_BYTES=24576`, `MAX_AUTHORITATIVE_BODY_BYTES=16384`, description limit `512`, and deterministic ordering. At most the authoritative set plus four supplemental records are fetched for adjudication; unselected records become status-only entries.
- Regression test: `F04_SUPPLEMENTAL_SLOT_EXHAUSTION_DOES_NOT_BLOCK_AUTHORITATIVE_EVIDENCE`, `F04_PER_SUBMITTER_LIMIT`, `F04_PROMPT_SIZE_BOUNDED`.
- Live verification: The deployed protocol view exposed the separate budgets and prompt limit. The live incident retained two authorized reporter slots while mismatch/failed records were isolated.
- Status: **FIXED**

### F-05 — No terminal resolution fallback

- Original issue: A claim and reserve could remain locked forever if nondeterministic resolution never produced a valid result.
- Root cause: No permissionless deadline-based terminal transition existed.
- Code change: Added snapshotted `resolution_timeout_seconds`, `resolution_deadline`, and permissionless `finalize_inconclusive_timeout`. It creates a terminal `INCONCLUSIVE` result, terminates pending claims as ineligible, closes challenge state if required, decrements open claims, and permits normal reserve release. The fallback cannot fabricate metrics or provider fault facts.
- Regression test: `F05_PERMISSIONLESS_INCONCLUSIVE_TIMEOUT`, `F05_PENDING_CLAIM_RELEASE_AFTER_TIMEOUT`, `F05_CHALLENGE_TIMEOUT_RELEASES_PENDING_CLAIM`.
- Live verification: Incident `3` used only attacker-controlled supplemental evidence. Buyer `0xF0eb25F0133B75257Eccaeb6dc9cE3A29D10de4B` called the fallback after the 60-second timeout. The result was `INCONCLUSIVE/RESOLUTION_TIMEOUT`, claim `3` became `INELIGIBLE`, `open_claims` became `0`, and reserve/premium release completed.
- Status: **FIXED**

### F-06 — Native transfer failure can burn credit

- Original issue: The available runtime transfer primitive does not provide a parent-call success acknowledgement/recovery callback for a child native transfer.
- Root cause: GenLayer Studio’s supported EOA value-transfer path is an external message; it does not expose a recoverable child-transfer acknowledgement suitable for atomic credit finalization.
- Code change: Implemented the strongest supported V1 limitation: `withdraw_credit` is self-only (`sender == origin`), rejects arbitrary recipient selection, debits credit before the external transfer, and exposes the withdrawal model as `SELF_ONLY_EOA_ORIGIN_EXTERNAL_FINALIZED`.
- Regression test: `F06_NO_DOUBLE_WITHDRAWAL` and `F06_TRANSFER_FAILURE_BEHAVIOR`. The latter deliberately models the runtime failure and confirms that credit is not reusable for a second withdrawal.
- Live verification: Tiny real EOA withdrawal succeeded in transaction `0x63b7c4a1252fd4618c5331e0e3d861689d89ad30d9dce266e93284392a22b3a6`, reducing credit `1005 -> 0`. A second real withdrawal was rejected by zero credit. A separate residual `10` credit was withdrawn once in `0x528b215ec46e28c17344f373e6e6422160cf4b9d0ec58f0a27a516d21b23e804`, reducing `10 -> 0`.
- Runtime evidence: The official [GenLayer value-transfer documentation](https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers) documents the EOA `emit_transfer` path and the absence of an application-level child-transfer acknowledgement/recovery callback.
- Status: **ACCEPTED LIMITATION**

### F-07 — Future/unbounded observation windows

- Original issue: Incidents could describe future or excessively broad historical intervals.
- Root cause: No on-chain current-time upper bound or maximum span.
- Code change: `open_incident` now requires `observed_start < observed_end`, `observed_end <= current deterministic transaction time`, and `observed_end - observed_start <= max_incident_span_seconds`. The bounded policy is snapshotted into each Incident.
- Regression test: `F07_FUTURE_INCIDENT_REJECTED`, `F07_OVERSIZED_INCIDENT_WINDOW_REJECTED`.
- Live verification: The deployed protocol exposed `max_incident_span_seconds=3600`; live incidents were opened with historical, bounded intervals. Future and oversized rejection are exercised against the current SDK contract harness.
- Status: **FIXED**

### F-08 — Challenge bond not snapshotted

- Original issue: Governance could change the global challenge bond after an Incident opened and make that Incident more expensive to challenge.
- Root cause: Challenge used the mutable global value rather than an Incident snapshot.
- Code change: Added `Incident.challenge_bond` and used it in `challenge_incident`; report bond and challenge bond are both snapshotted at opening.
- Regression test: `F08_CHALLENGE_BOND_SNAPSHOT`.
- Live verification: Incident `2` stored bond `7`; governance changed the global bond to `99`; the challenge transaction `0x5b691aba78740ac7bfb19029e09e665ce041e8d85ae01da0a52c7167acd84fc1` paid exactly `7`. Incident `1` provided the same test path.
- Status: **FIXED**

### F-09 — Scope normalization

- Original issue: Case and whitespace variants could compare inconsistently, and empty string could act as an accidental wildcard.
- Root cause: Normalization was not applied once at the trust boundary.
- Code change: Added bounded strip/lowercase syntax normalization. New Pact scope and authoritative evidence scope reject empty strings; `global` is the only explicit global token. Resolution scope is validated/derived from accepted authoritative evidence before deterministic claim comparison.
- Regression test: `F09_SCOPE_NORMALIZATION`, `F09_SCOPE_DERIVED_FROM_AUTHORITATIVE_EVIDENCE`, `F09_EMPTY_SCOPE_REJECTED`.
- Live verification: Final live Pact and Resolution scope were both canonical `us-east`; the live resolution support was `[1,2]` and the Pact differential settlement used that normalized scope.
- Status: **FIXED**

### F-10 — Maintenance exclusion terms not enforced

- Original issue: Pact maintenance fields were advertised but payout logic did not enforce a deterministic maintenance record.
- Root cause: A model-selected maintenance boolean could affect settlement without an on-chain maintenance source.
- Code change: Disabled custom maintenance exclusions for V1. Removed maintenance fields from `PactTerms`, Pact creation/revision parameters, views, Resolution facts, prompts, and payout evaluation. No maintenance exclusion can deny payout in this candidate.
- Regression test: `F10_MAINTENANCE_POLICY_ENFORCED_OR_DISABLED`.
- Live verification: `get_protocol_config` returned `maintenance_policy=DISABLED_V1`; `get_pact_terms` contained no maintenance fields.
- Status: **FIXED — disabled in V1**

### F-11 — Dead `cancel_pending_coverage` API

- Original issue: The method always reverted despite there being no pending Coverage state.
- Root cause: A compatibility method described a lifecycle that did not exist.
- Code change: Removed `cancel_pending_coverage`; no replacement lifecycle was added.
- Regression test: `F11_NO_DEAD_PENDING_COVERAGE_API`.
- Live verification: Final deployed schema contained 78 methods and no `cancel_pending_coverage`.
- Status: **FIXED**

### F-12 — Additional hardening items

- Original issue: Missing PPM bounds, weak p95/block-lag bounds, empty scope acceptance, inconsistent hash validation, inaccurate provider stats, misleading terminal payout views, and publishable retired-service revisions.
- Root cause: Several input and state transitions relied on implicit assumptions.
- Code change: Added availability/error-rate limits at `1_000_000`, `MAX_P95_LATENCY_MS=86_400_000`, `MAX_BLOCK_LAG=10_000_000`, normalized/validated hashes, explicit `global`, stats updates only for actual finalized facts, terminal claim payout status/actionability, and retired-service checks for new drafts/revisions/publication.
- Regression test: `F12_PPM_BOUNDS`, `F12_PROVIDER_STATS_NO_INCIDENT`, `F12_RETIRED_SERVICE_CANNOT_PUBLISH_NEW_PACT`, plus the retained accounting/invariant tests.
- Live verification: The final protocol view exposed the production-safe bounds; provider stats showed `provider_fault_incidents=2` for two confirmed provider incidents and `inconclusive_incidents=1` for the timeout, with no false increment for the inconclusive case. Terminal payout view returned `actionable=false` and stored status/result.
- Status: **FIXED**

## New Architecture Changes

- Evidence provenance is snapshotted at submission. Authorization revocation changes future submissions only; it does not reinterpret old evidence.
- Authoritative evidence is limited to authorized probe, independent monitor, or chain-reference types and must match the strict structured schema.
- Payout-bearing facts carry per-fact evidence IDs. The contract verifies existence, Incident ownership, successful fetch/hash/schema validation, authoritative provenance, unique reporter quorum, and exact structured values.
- Failed or mismatched evidence is represented to the model only by fixed status tokens. Supplemental content is bounded, labeled untrusted, and cannot satisfy financial support.
- Financial interval consensus is exact. Duration is derived on-chain from the accepted interval.
- Resolution, quorum, timeout, and incident-span policies are snapshotted into each Incident.
- V1 maintenance exclusions are disabled rather than partially enforced.
- Withdrawals are self-only EOA/origin external transfers because the pinned runtime has no usable child-transfer acknowledgement/recovery callback.

## API Changes

Removed or disabled:

- Removed `cancel_pending_coverage`.
- Removed `maintenance_exclusion_uri` and `maintenance_exclusion_hash` from Pact creation/revision arguments, storage, views, prompts, and payout logic.
- Removed the Resolution `maintenance_exclusion` fact.

Added:

- Constructor arguments: `min_authoritative_reporters`, `resolution_timeout_seconds`, `max_incident_span_seconds`.
- `authorize_reporter(reporter)` and `revoke_reporter(reporter)`.
- `set_resolution_policy(min_authoritative_reporters, resolution_timeout_seconds, max_incident_span_seconds)`.
- Permissionless `finalize_inconclusive_timeout(incident_id)`.
- View `is_authorized_reporter(reporter)`.

Changed:

- Pact terms require normalized nonempty scope and bounded metrics; URI-backed hashes must be valid SHA-256 values.
- Incident opening validates historical bounded intervals and snapshots bond/quorum/timeout policy.
- Evidence submission keeps the existing high-level call but classifies provenance and applies separate budgets.
- Resolution storage/views add deterministic fact support and remove maintenance facts.
- `withdraw_credit` accepts only the caller’s own origin and uses the documented self-only transfer model.
- Final deployed schema: 78 methods, 23 readonly views, 55 writes, 12 constructor parameters.

New storage structures/fields:

- `authorized_reporters: TreeMap[Address, bool]`.
- `incident_claim_ids: TreeMap[u256, DynArray[u256]]`.
- Protocol quorum/timeout/span fields.
- Incident quorum/timeout/span/deadline/challenge-bond snapshots.
- Evidence provenance and authorization-at-submission fields.
- Resolution `fact_support_json`.

## Tests

- Permanent suite: `tests/test_phase_0_1_hardening.py`
- Exact test count: **38**
- Passed: **38**
- Failed: **0**
- Skipped: **0**
- Current-SDK execution: `PYTHONPATH=/tmp/faultpact-sdk-v06 /tmp/faultpact-testenv/bin/pytest -q tests/test_phase_0_1_hardening.py --disable-warnings`
- Python compilation: passed for contract and test suite.
- `genvm-lint lint contracts/FaultPact.py`: passed, 3 checks.
- Current SDK direct harness and deployed schema/runtime checks: passed.

The permanent tests exercise actual contract logic with the pinned current SDK storage/calldata/runtime model. Web, LLM, and transfer boundaries are controlled only where the local harness must replace external services; real GenLayer resolution, reads, writes, and value withdrawal were separately exercised on Studio Dev.

## Remaining Risks

- F-06 remains an accepted GenLayer runtime limitation: if the external child transfer fails after the parent transaction is accepted, the runtime does not provide a callback/acknowledgement path to restore the debited credit. V1 limits withdrawals to the caller’s own EOA/origin and prevents double reuse, but does not claim atomic recoverability.
- The installed `genvm-linter 0.11.0` `validate`/`schema` command could not load the current `v0.6.0-rc5` SDK artifact layout: it looked for `runners/py-genlayer/5j/ycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng.tar`, while the current bundle uses the `executor/v0.2.17/legacy-runners` layout. This is recorded as a tooling compatibility limitation, not reported as a validation pass. Fast lint, current-SDK execution, live deployment, and live schema extraction passed.
- Studio Dev RPC rate-limits standard reads at 30 requests per minute. The final view certification was rerun after the rate window cleared and completed 23/23 PASS.

## Status

**FAULTPACT V1 HARDENED CANDIDATE — READY FOR INDEPENDENT RE-AUDIT**

This is not a final contract freeze and is not an independent audit pass.
