# FaultPact V1 Independent Contract Audit

Audit date: 2026-09-21 UTC<br>
Scope: read-only review of `/root/faultpact/contracts/FaultPact.py` and the certified Studio Dev deployment.  No production source, deployment, or live state was changed.

## 1. Executive Summary

Overall: **FAIL**

The source is byte-for-byte identical to the certified deployment and the requested public API counts are exact.  The capital, reserve, payout-cap, replay, and basic access-control paths are substantially stronger than the AI adjudication boundary.

Three high-severity findings remain:

- The contract treats arbitrary submitter-controlled, hash-valid evidence as an authoritative input to payout-bearing incident facts. SHA-256 proves body integrity, not source authenticity or factual truth; consensus can confirm the same poisoned input.
- Hash-mismatched evidence is still placed in the LLM prompt, and no post-processing binds financial facts to valid evidence IDs. A failed source can therefore influence a resolution alongside valid sources.
- The equivalence comparator allows incident times and duration to differ by 300 seconds while payout eligibility uses the leader's exact interval. A leader interval can qualify a claim while the validator interval does not overlap the coverage or meet the Pact minimum duration.

No direct deterministic path was found to over-reserve capital, settle twice, release premium twice, or pay above a Coverage's remaining backed limit. The high findings are nevertheless sufficient for an audit failure because they affect the financial oracle and claim eligibility.

## 2. Source Integrity

| Item | Result |
|---|---|
| Path | `contracts/FaultPact.py` |
| SHA before audit | `dcdcec387a5c42687898f1484ce6455dfd346579010e64270919e845d145386f` |
| SHA after audit | `dcdcec387a5c42687898f1484ce6455dfd346579010e64270919e845d145386f` |
| Expected SHA | `dcdcec387a5c42687898f1484ce6455dfd346579010e64270919e845d145386f` |
| Match | YES |
| Certified deployment source | YES: `gen_getContractCode` returned 117,324 decoded bytes with the same SHA and exact byte equality |
| Dependency pin | Present in line 1: `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| Contract class | `FaultPact` at line 358 |
| Alternative production contract | None found; only the requested source and a generated `__pycache__` artifact were present |
| TODO/FIXME/stub markers | No TODO/FIXME/NotImplemented markers; `pass` is limited to interface shells and exception fallback branches |

The workspace is not a Git repository. `git status`, branch lookup, and commit lookup returned `fatal: not a git repository`; branch and commit are therefore unavailable, and Git cleanliness cannot be asserted. No repository files other than this report were intentionally changed.

The workspace has no importable `genlayer` Python module. An audit-only temporary environment contained `genlayer-test 0.29.2` / `genlayer-py 0.16.3`, but not the certified `py-genlayer` dependency hash, so no exact-version local direct deployment was claimed. The live code endpoint and schema checks were used instead.

## 3. Certified Deployment Reference

| Field | Certified value |
|---|---|
| Network | GenLayer Studio Development Preview |
| RPC | `https://studio-dev.genlayer.com/api` |
| Chain ID | `0xf22d` = `61997` |
| Contract | `0xE3A4BCA106Fe0021c9fb664F73ef5F2FB1c0c3fd` |

Read-only live calls performed:

- `eth_chainId`
- `gen_getContractCode`
- `gen_getContractSchema`

No state-changing live call, deployment, deposit, purchase, incident, claim, or withdrawal was made. `gen_getContractState` was not implemented by the endpoint; an attempted read-only `gen_call` view invocation returned `malformed_entry` with the locally installed client encoding, so populated state views were not treated as verified.

## 4. Contract Inventory

### Constructor

`__init__` (lines 386-441) accepts treasury, guardian, fee, withdrawal cooldown, report/challenge bonds, and three incident windows. It initializes owner from `gl.message.sender_address`, rejects zero treasury/guardian, caps the protocol fee at 1,000 bps, bounds cooldown/windows, sets `min_premium=1`, and starts all counters at 1.

### Persistent storage

- `ProtocolConfig`: owner/pending owner, treasury/pending treasury, guardian/pending guardian, fee, cooldown, report/challenge bonds, pause flag, minimum premium, and incident windows.
- `Provider`: identity, owner transfer state, metadata, timestamps, existence.
- `ProviderVault`: total, allocated, reserved, pending withdrawal, unlock timestamp.
- `ProviderStats`: coverage, incident, claim, payout, deposit, and fault counters.
- `Service`: provider relationship, type/name/metadata, lifecycle status, timestamps.
- `PactTerms`: frozen SLA thresholds, scope, durations, amounts, premium, deductible, payout cap, maintenance reference, terms reference.
- `Pact`: service/provider relationship, revision/parent, lifecycle status, timestamps.
- Pact accounting: `pact_allocated`, `pact_reserved`.
- `Coverage`: frozen Pact reference, buyer, limits, lifecycle/deadlines, premium split, reserve, open claims, settlement flags.
- `Incident`: service/provider/opener, observed window, evidence/challenge deadlines, lifecycle, bond, acknowledgement, round state.
- `incident_evidence_ids: TreeMap[u256, DynArray[u256]]` and `Evidence`: append-only evidence records.
- `Resolution`: canonical incident facts and finalized flag.
- `Challenge`: one challenge per incident, bond, original facts, resolution flags.
- `Claim`: Coverage/Incident/Pact relationship, claimant, status, payout.
- `claim_index`: exact Coverage + Incident duplicate key.
- `credits`: internal native-GEN claimable balances.
- Seven monotonic counters for provider, service, Pact, Coverage, Incident, evidence, and claim IDs.

### Public API counts

Source AST inventory and live `gen_getContractSchema` agree:

| Category | Count |
|---|---:|
| Public methods | 74 |
| Public views | 22 |
| Public writes | 52 |
| Payable writes | 4 |

Payables: `deposit_capital`, `buy_coverage`, `open_incident`, `challenge_incident`.

Views: `quote_coverage`, `can_finalize_incident`, `calculate_claim_payout`, `preview_claim_payout`, `can_settle_claim`, `get_protocol_config`, `get_counters`, `get_provider`, `get_provider_vault`, `get_provider_stats`, `get_service`, `get_pact`, `get_pact_terms`, `get_pact_capacity`, `get_coverage`, `get_incident`, `get_incident_resolution`, `get_evidence`, `get_incident_evidence_ids`, `get_challenge`, `get_claim`, `get_claimable_balance`.

Writes are enumerated in the access-control matrix in section 9.

## 5. Architecture Assessment

| Layer | Assessment |
|---|---|
| Provider | Permissionless registration; provider owner controls services, Pact revisions, capital, and metadata. Two-step control transfer is present. |
| Service | Provider-owned lifecycle. Pausing/retiring stops new sales through `_pact_sellable`; historical claim paths do not require the service to remain active. |
| Pact | Draft terms can be changed; publication freezes terms. Revisions create new Pact IDs and Coverage stores the exact Pact ID. |
| Coverage | Buyer-owned, fully reserved at the advertised limit, with a remaining-limit cap and claim deadline. |
| Incident | Permissionless opener and evidence collection; service/provider are bound at creation, but observed timestamps are not bounded by current time. |
| Evidence | SHA-256 of fetched response bytes is checked, but hash-validity is not authenticity and failed response content still reaches the model. |
| Resolution | One resolution per Incident, fact-shaped rather than Pact-shaped. Malformed fields fail closed, but facts remain LLM-derived. |
| Challenge | One permissionless challenge round with a bond. Challenge re-runs the same adjudication over the full evidence set. |
| Claim | Buyer-only filing, exact Coverage+Incident duplicate prevention, pending/settled/ineligible state. |
| Credit | Internal ledger for refunds, bonds, payouts, and withdrawals; native transfer is an asynchronous external message. |

## 6. Findings Summary

| ID | Severity | Title | Component | Status |
|---|---|---|---|---|
| F-01 | HIGH | Hash-valid attacker evidence is a payout-bearing oracle without provenance or source grounding | Evidence / Resolution / Claims | CONFIRMED STRUCTURAL RISK |
| F-02 | HIGH | Failed or hash-mismatched evidence remains in the financial adjudication prompt | Evidence / Resolution | CONFIRMED |
| F-03 | HIGH | 300-second consensus tolerance can change financial eligibility | Equivalence / Claim evaluation | CONFIRMED; executable boundary PoC |
| F-04 | MEDIUM | Permissionless incident/evidence spam can exhaust adjudication resources and evidence slots | Incident / Evidence / Resolution | CONFIRMED REACHABLE DOS VECTOR |
| F-05 | MEDIUM | No deterministic permissionless terminal path if resolution consensus never succeeds | Incident / Coverage / Claim | CONFIRMED LIVENESS GAP |
| F-06 | MEDIUM | External transfer failure can permanently burn a user's credit | Credits / Native GEN | CONFIRMED BY DOCUMENTED SEMANTICS; reachability depends on recipient/runtime failure |
| F-07 | MEDIUM | Future and arbitrarily broad observed windows are accepted | Incident / Claim filing | CONFIRMED VALIDATION GAP |
| F-08 | LOW | Challenge bond is not snapshotted for an active Incident | Governance / Challenge | CONFIRMED |
| F-09 | LOW | Case-insensitive scope comparison is unreachable, causing avoidable consensus failure | Equivalence | CONFIRMED |
| F-10 | LOW | Stored Pact maintenance-exclusion terms are not bound to deterministic claim evaluation | Pact / Resolution / Claims | CONFIRMED LOGIC GAP |
| F-11 | INFORMATIONAL | `cancel_pending_coverage` always reverts and no pending coverage exists | Coverage API | CONFIRMED DEAD API |
| F-12 | INFORMATIONAL | Several input/view/stat consistency gaps remain | Input validation / Views / Stats | CONFIRMED HARDENING ITEMS |

## 7. Detailed Findings

### F-01 — HIGH — Hash-valid attacker evidence is a payout-bearing oracle without provenance or source grounding

Affected functions: `submit_evidence` (1708-1725), `attach_incident_report` (1611-1626), `open_incident` (1554-1609), `_fetch_one_evidence` (1990-2041), `_adjudicate` (2097-2202), `_run_resolution_consensus` (2204-2223), `_payout_from_parts` (2457-2506).

Description: The contract proves only that the fetched response bytes equal a submitter-chosen SHA-256 hash. Any account can choose the URI, host the content, choose the description, and submit the hash. The prompt explicitly says hash-valid JSON/text that states metrics or fault data is usable. There is no signature, source allowlist, independent monitor authentication, minimum independent-source rule, or deterministic fact derivation. The resulting LLM facts directly control `fact_status`, `fault_domain`, `scope`, incident interval, and metric values used by deterministic payout.

Attack scenario:

1. A customer controls a Coverage and hosts a JSON body claiming a Provider outage, matching scope, a long duration, and a threshold-breaking p95.
2. The customer opens an Incident for the service and submits the exact SHA-256 of that body.
3. After the evidence window, `_fetch_one_evidence` marks the body `ok=True` and `hash_ok=True`.
4. The prompt permits the model to use the body and its attacker-controlled description. If the leader returns `INCIDENT_CONFIRMED`, `PROVIDER`, matching scope, and a violating metric, `_apply_fetch_overrides` does not change those facts.
5. The validator independently fetches the same attacker-controlled bytes and reruns the same adjudication task. Matching poisoned facts satisfy the comparator.
6. After finalization, the customer files and settles a claim. The deterministic code pays from reserved capital. Distinct Incidents can repeat until the Coverage remaining limit is exhausted.

Preconditions: an active funded Coverage, a reachable attacker-controlled URL, and an adjudication result accepting the attacker-controlled source as sufficient. A successful attack drains only the Coverage/Provider liability that is already reserved, but can drain that liability without a real incident.

Impact: Material false payouts and possible exhaustion of all reserved Provider capital. This is HIGH rather than CRITICAL because the final exploit requires the model/validator population to accept the fabricated evidence and the normal challenge/finalization lifecycle to complete.

Reproduction: The audit POC confirms the executable path: evidence is considered valid solely from response-byte hash equality, while the output fact fields are not tied to source authenticity or verified source IDs. The deterministic p95 differential and claim math also passed in `/tmp/faultpact-audit/pocs.py`.

Why existing checks do not stop it: hash format, response hashing, enum validation, time bounds, evidence-ID validation, and independent rerun consensus all work as coded. They do not answer whether the source is authentic or whether the facts follow from it. Consensus proves agreement on the same untrusted input, not truth.

Suggested remediation: require authenticated or allowlisted evidence sources where possible; bind every financial fact to valid evidence IDs; require an explicit quorum/independence policy; have validators independently verify source-grounded facts rather than merely rerun the same open-ended extraction; and do not treat arbitrary submitter descriptions as factual measurements without provenance.

Confidence: High for the structural weakness; Medium for any particular model prompt producing the malicious result.

### F-02 — HIGH — Failed or hash-mismatched evidence remains in the financial adjudication prompt

Affected functions: `_fetch_one_evidence` (1990-2041), `_adjudicate` (2097-2126), `_apply_fetch_overrides` (2043-2095).

Description: A failed source is correctly moved out of `usable_evidence_ids`, but its description—and, for a hash mismatch, the fetched body—are still placed in `evidence_blocks` and sent to `gl.nondet.exec_prompt`. The post-fetch override changes only the ID lists and sometimes `fact_status`; it does not discard or revalidate the facts the LLM produced from the failed content. When at least one other source remains usable, a failed source can influence financial fields without forcing `INCONCLUSIVE`.

Attack scenario:

1. Submit evidence with a committed hash.
2. Change the URI body before adjudication, producing a hash mismatch, or make the URL return a failure response while its on-chain description contains prompt-injection or false incident facts.
3. `_fetch_one_evidence` records `ok=False`/`hash_ok=False`, but `_adjudicate` still emits the item's `DESCRIPTION` and, for a hash mismatch, its fetched `CONTENT`.
4. The model returns facts influenced by the failed item and marks a separate valid item usable.
5. `_apply_fetch_overrides` moves only the failed ID to unusable; it leaves the model's incident facts intact, so the valid item prevents the conservative all-failure downgrade.

Impact: One invalid or mutable source can poison an otherwise valid adjudication and change payout-bearing facts. It also defeats the intended guarantee that unusable evidence cannot become financially influential merely through model output.

Reproduction: The POC shows a failed evidence body and description remain in the exact prompt payload while the failed ID is only moved to the unusable list. The relevant prompt construction is visible at lines 2105-2122; the override at lines 2055-2095 never edits fact fields based on the failed content.

Why existing checks do not stop it: the prompt labels the block untrusted and the ID list is conservative, but no deterministic rule removes failed content from the model input or checks that each returned fact cites a successful evidence ID.

Suggested remediation: exclude failed/mismatched bodies and descriptions from the model prompt entirely, or expose only a fixed failure token; require fact-to-evidence attribution; and reject or downgrade any fact whose cited support is not `ok=True` and `hash_ok=True`.

Confidence: High.

### F-03 — HIGH — 300-second consensus tolerance can change financial eligibility

Affected functions: `_decision_fields_match` (1959-1988), `_validate_resolution_schema` (1849-1957), `_payout_from_parts` (2457-2506), `resolve_incident` (2256-2271), `resolve_challenge` (2344-2369).

Description: The comparator allows each of `incident_start`, `incident_end`, and `duration_seconds` to differ by up to `TIME_TOLERANCE_SECONDS=300`. Claim evaluation later uses the leader's exact resolution interval and duration against strict Coverage overlap and Pact minimum-duration rules.

Concrete accepted disagreement:

- Observed window: `[800, 1000]`.
- Leader result: `[800, 1000]`, duration `200`.
- Validator result: `[1000, 1000]`, duration `0`.
- All non-time decision fields are equal.
- Start difference is `200`, end difference `0`, duration difference `200`; `_decision_fields_match` returns true.
- A Coverage window `[900, 950]` overlaps the leader interval but not the validator interval.
- A Pact minimum incident duration of `100` accepts the leader interval but not the validator interval.

The schema accepts both intervals: `end >= start` and both remain within the observed window plus the 300-second bounds. The POC executed this comparator and boundary result successfully.

Impact: Consensus can approve a leader fact pattern that an independent validator did not agree qualifies for a claim. This can create false payouts or, in the opposite direction, reject a valid payout. The defect is financial because the tolerated fields are not merely explanatory; they are inputs to `_payout_from_parts`.

Why existing checks do not stop it: exact metric fields and normalized enums are compared, but the time tolerance is applied before financial evaluation and no validator-side derived eligibility/overlap result is compared.

Suggested remediation: compare payout-relevant interval relationships exactly, remove tolerance from decision-bearing times, or compare a conservative deterministic eligibility summary for each frozen Pact rather than tolerating raw time fields that can cross boundaries.

Confidence: High.

### F-04 — MEDIUM — Permissionless incident/evidence spam can exhaust adjudication resources and evidence slots

Affected functions: `open_incident` (1554-1609), `attach_incident_report` (1611-1626), `submit_evidence` (1708-1725), `_store_evidence` (1656-1690), `_collect_evidence_mem` (1731-1755), `_fetch_one_evidence` (1990-2041), `_adjudicate` (2097-2202).

Description: Any account can attach up to 32 ordinary evidence items and 16 challenge items without a per-item bond or provenance restriction. Evidence is append-only and every stored item is fetched and concatenated into the adjudication prompt. Response truncation to 4,000 characters occurs after the full response has been fetched and hashed, while descriptions are truncated only to 500 characters at prompt construction. An attacker can also create evidence-free Incidents; the report bond is always refunded at finalization regardless of fact outcome, and can be configured to zero.

Reproduction: 32 ordinary items at the configured 4,000-character content truncation plus the 500-character prompt description truncation contribute about 144,000 bytes before delimiters/system overhead. The POC computed this bound. A single much larger response is still fetched and hashed before truncation. An attacker can fill the cap before the legitimate reporter submits evidence, making the evidence set permanently noisy and increasing web/LLM work.

Impact: Elevated validator cost, prompt-context overflow depending on the deployed model limit, resolution disagreement, and possible lifecycle stalls. The exact point at which the current Studio model rejects the prompt was not available without the certified runner/model configuration, so permanent context failure is not asserted as a proved outcome.

Why existing checks do not stop it: the cap limits count but not aggregate bytes, fetch cost, or prompt size; ordinary evidence submission is free and permissionless; there is no removal, pagination, or deterministic evidence-selection rule.

Suggested remediation: bound total bytes and response size before adjudication, charge or rate-limit evidence/Incident creation, reserve evidence slots by role or require a deterministic selection policy, and provide a way to finalize an all-failure/noisy case as `INCONCLUSIVE`.

Confidence: High for evidence-slot/resource exhaustion; Medium for model-specific context failure.

### F-05 — MEDIUM — No deterministic permissionless terminal path if resolution consensus never succeeds

Affected functions: `resolve_incident` (2256-2271), `resolve_challenge` (2344-2369), `_can_finalize` (2371-2388), `finalize_incident` (2395-2423), `_coverage_releasable` (1522-1529), `release_earned_premium` (1531-1548), `settle_claim` (2594-2634).

Description: An Incident can only reach finalization after a successful nondeterministic resolution. Malformed LLM output, repeated validator disagreement, runtime/model outage, or a prompt that exceeds execution limits causes resolution to fail/undetermined. There is no timeout fallback that records `INCONCLUSIVE`, refunds/forfeits the report bond, or allows a claim/coverage reserve to reach a terminal state.

Attack/liveness scenario: A customer files a claim before the Coverage deadline, setting `open_claims > 0`. The evidence URI disappears or the model/validators never agree. Every `resolve_incident` attempt fails; `finalize_incident` remains unavailable, and `release_earned_premium` remains blocked because `open_claims != 0`. The Provider reserve and customer claim remain locked indefinitely unless the external adjudication layer recovers.

Impact: Permanent or indefinite liveness failure and locked economic value, including the report bond and any challenge bond awaiting resolution. This is not an arbitrary theft path, but it violates the intended permissionless recovery property.

Why existing checks do not stop it: the contract correctly fails closed on malformed facts, but fail-closed resolution has no alternate on-chain terminal transition.

Suggested remediation: add a deterministic timeout/fallback path that can finalize `INCONCLUSIVE` after all evidence is unusable or consensus retries expire, with explicit treatment of open claims and reserves. Ensure the fallback is permissionless and does not depend on the owner or guardian.

Confidence: High for the missing recovery path; actual permanent occurrence depends on nondeterministic execution availability.

### F-06 — MEDIUM — External transfer failure can permanently burn a user's credit

Affected functions: `_send_native` (605-616), `withdraw_credit` (2636-2642).

Description: `withdraw_credit` debits the internal credit ledger before emitting an external GEN transfer. Current official GenLayer documentation states that message value is deducted when emitted and is not automatically returned if the child message fails. The contract comment intentionally acknowledges that a failed child transfer burns credit.

Impact: If the recipient is a rejecting contract, the external message fails, or a runtime/finalization failure occurs after emission, the user loses the internal credit and has no retryable balance. This affects the withdrawing account rather than allowing theft from another account, but it is real user-fund loss/stuck-value risk.

Why existing checks do not stop it: debiting first prevents double withdrawal, but there is no pending-withdrawal state, success callback, or recovery path.

Suggested remediation: use a pending withdrawal/acknowledgement mechanism if supported by the target runtime, or preserve credit until a successful transfer is confirmed; otherwise restrict recipients to transfer-safe EOAs and document the irreversibility prominently.

Evidence: [GenLayer Value Transfers](https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers) documents sender balance → message → recipient balance and states that failed child messages do not automatically return value; [GenLayer Messages](https://docs.genlayer.com/developers/intelligent-contracts/features/messages) documents external-message finalization.

Confidence: High for the documented semantics; Medium for the frequency of a failing EOA transfer on the certified Studio runtime.

### F-07 — MEDIUM — Future and arbitrarily broad observed windows are accepted

Affected functions: `open_incident` (1554-1609), `_validate_resolution_schema` (1849-1887), `_validate_claim_filing` (2508-2524), `_payout_from_parts` (2457-2471).

Description: `open_incident` checks only `observed_end >= observed_start`; it does not require the observed window to be historical or bounded by the transaction timestamp. Resolution is only constrained to that user-supplied window plus the 300-second tolerance. Claim filing uses overlap with the stored observed window and does not require the observed incident to have occurred by filing time.

Attack scenario: A customer submits an Incident with a future or extremely broad observed window that overlaps an active Coverage, supplies evidence claiming a Provider outage, and files a claim before the purported incident time. The model may later produce a resolution interval inside the future window, and deterministic claim logic accepts the overlap if the remaining facts qualify.

Impact: Temporal integrity is delegated to the AI/evidence path rather than enforced on-chain. This expands the false-claim surface and lets one resolution window overlap unrelated Coverages.

Why existing checks do not stop it: `observed_start/end` are user inputs, and the schema only checks internal order and bounds relative to those inputs.

Suggested remediation: require `observed_end <= opening transaction timestamp` for V1 historical incidents, or explicitly define and enforce a future-incident model with a separate activation/finality rule. Also bind resolution end and claim filing to the transaction timestamp where appropriate.

Confidence: High for the validation gap; financial exploitation still depends on adjudication accepting the evidence.

### F-08 — LOW — Challenge bond is not snapshotted for an active Incident

Affected functions: `set_bonds` (924-930), `open_incident` (1554-1609), `challenge_incident` (2277-2324).

Description: Report bond and incident windows are copied into `Incident` at opening, but `challenge_incident` reads the current global `config.challenge_bond` when the challenge is filed. An owner can change the challenge bond after an Incident reaches `PRELIMINARY` and before its challenge deadline.

Impact: An active case can become more expensive to challenge or free to spam, contrary to the otherwise snapshot-based lifecycle design. This is an admin/configuration integrity issue, not an unprivileged takeover.

Suggested remediation: snapshot `challenge_bond` into the Incident or explicitly document that it is intentionally live-configured.

Confidence: High.

### F-09 — LOW — Case-insensitive scope comparison is unreachable, causing avoidable consensus failure

Affected function: `_decision_fields_match` (1959-1988).

Description: `scope` is included in the exact-value `keys` loop at lines 1960-1974. The later intended case-insensitive comparison at lines 1975-1976 is therefore never reached for case-only differences. A leader result of `US-EAST` and validator result of `us-east` disagree even though the second comparison appears intended to accept them.

Impact: A harmless model formatting difference can make resolution undetermined and contribute to F-05 liveness failures.

Suggested remediation: normalize scope once during schema validation or remove `scope` from the exact loop and use the intended normalized comparison.

Confidence: High.

### F-10 — LOW — Stored Pact maintenance-exclusion terms are not bound to deterministic claim evaluation

Affected functions: `_build_terms` (686-747), `_terms_dict` (749-772), `_payout_from_parts` (2457-2506), `_adjudicate` (2097-2202).

Description: Pact terms store `maintenance_exclusion_uri` and `maintenance_exclusion_hash`, but resolution never fetches or validates them and claim evaluation uses only the LLM-provided `res.maintenance_exclusion` boolean. Any true value rejects the claim, even if the Pact has no exclusion reference; a false value permits the claim without deterministic comparison to the Pact exclusion policy.

Impact: Advertised maintenance policy and financial evaluation can diverge. A Provider can publish terms whose stored exclusion reference has no enforcement, and a model classification can independently deny or permit the claim.

Suggested remediation: define maintenance policy deterministically in Pact terms and evaluate a canonical, authenticated exclusion fact; otherwise remove the unused term fields and document that any fact-level maintenance flag is a global exclusion.

Confidence: High for the term-binding gap; severity is LOW because the result still requires a finalized resolution and the policy meaning is not fully specified in the source.

### F-11 — INFORMATIONAL — `cancel_pending_coverage` always reverts and no pending coverage exists

Affected function: `cancel_pending_coverage` (1508-1512).

Description: The method authenticates the buyer and then unconditionally raises `ERR_ALREADY_ACTIVE`. `buy_coverage` creates a Coverage atomically, so there is no pending state to cancel.

Impact: Frontends integrating the advertised method may present an unusable cancellation path. No value is lost by the method itself because it always reverts.

Suggested remediation: remove the dead method from the API or implement a real pending-purchase state before advertising it.

Confidence: High.

### F-12 — INFORMATIONAL — Input/view/stat consistency gaps

Confirmed hardening items:

- `availability_threshold_ppm` and `error_rate_threshold_ppm` are not capped at `PPM_DENOM`; values above 1,000,000 create clauses that cannot be violated by a valid resolution (lines 686-747).
- `observed_p95_latency_ms` and `observed_block_lag` have only nonnegative checks and no protocol-defined upper/plausibility bound; an accepted model/evidence value can therefore be arbitrarily large (lines 1880-1888).
- Empty `region_scope` is accepted and treated as a wildcard by `_scope_covered` (lines 2432-2439).
- Metadata and `terms_hash` fields are length-checked but not validated as SHA-256 values; only evidence hashes are normalized and checked.
- `finalize_incident` increments `provider_fault_incidents` from `fault_domain` even when `fact_status == NO_INCIDENT`; claims still reject `NO_INCIDENT`, but stats can be misleading (lines 2410-2423).
- `calculate_claim_payout` recomputes current eligibility for a claim regardless of its settled/ineligible status, while `can_settle_claim` separately checks status. This is a frontend/view hazard, not a settlement bypass (lines 2549-2573, 2584-2592).
- Drafts and revisions can be published for a retired Service; `_pact_sellable` then makes them permanently unsellable because retired Services cannot resume. This creates dead configuration, not an asset-loss path.

## 8. Economic Invariants

| Invariant | Result | Reason |
|---|---|---|
| `reserved_capital <= allocated_capital <= total_capital` | PASS for reachable state transitions | `_assert_vault_invariants` is applied after reserve, release, allocation, deallocation, deposit, withdrawal, and payout paths. |
| `allocated_capital + pending_withdrawal <= total_capital` | PASS | Requests reserve pending capacity; allocation excludes pending; execute rechecks free capital. |
| Sum Pact allocations <= Provider allocation | PASS | `allocate_capital`, `deallocate_capital`, and `_debit_provider_capital` update both sides. |
| Sum Pact reserves <= Provider reserve | PASS | `_reserve_for_coverage`, `_release_reserve`, and `_debit_provider_capital` update both sides. |
| Full Coverage backing | PASS for reachable ordinary Coverage state | `reserved_amount == coverage_limit`; reserve requires Pact capacity; payout is capped by remaining limit and reserved amount. |
| Multiple claims cannot exceed Coverage remaining limit | PASS | `remaining_limit` is decremented on settlement and used as the payout source. Duplicate Coverage+Incident claims are rejected. |
| No double settlement | PASS | Claim must be `CLAIM_PENDING_RESOLUTION`; successful and ineligible paths both change status. |
| No double premium release | PASS | `premium_released` flag guards provider-share credit. |
| No reserve release with pending claims | PASS | `_coverage_releasable` requires `open_claims == 0` and both deadlines/end time passed. |
| Withdrawal solvency | PASS before external-message execution | Pending withdrawal and allocation checks prevent withdrawing reserved/allocated capital. |
| Premium fee/provider split | PASS | Round-up fee is capped at gross; `fee + provider_share == gross`. |
| Credit ledger single debit | PASS internally; FAIL on external child-failure recovery | `withdraw_credit` debits once, but has no recovery if the emitted transfer later fails (F-06). |

Representative arithmetic was recomputed in `/tmp/faultpact-audit/pocs.py`: one-year 100-bps premium on `1e18` wei is `1e16`; at 10% fee the split is `1e15`/`9e15`; a 5% deductible on a full-limit payout leaves `95e16` wei; a 1-bps cap on a 1-wei limit rounds to zero.

## 9. Access Control Matrix

`Permissionless` means any caller satisfying the state/deadline checks. `Replay` describes repeated calls after a successful transition.

| Write method (lines) | Caller and preconditions | Reads / writes / value | Transition, failure, replay, economic effect |
|---|---|---|---|
| `pause_new_sales` (845-849) | Owner or guardian | Config / `sales_paused=True`; no value | Stops new sales; re-call is harmless/idempotent; recovery requires owner. SAFE. |
| `resume_new_sales` (852-856) | Owner | Config / `sales_paused=False` | Re-enables sales; idempotent. SAFE. |
| `set_protocol_fee` (859-865) | Owner; fee <= 1,000 bps | Config / fee | Affects future Quotes/Coverages only; invalid cap reverts. SAFE. |
| `set_treasury` (868-873) | Owner; nonzero address | Config / pending treasury | Two-step rotation; overwriting pending is allowed. SAFE. |
| `accept_treasury` (876-881) | Exact pending treasury | Config / treasury, clear pending | Wrong caller/replay reverts; no value movement. SAFE. |
| `set_guardian` (884-889) | Owner; nonzero address | Config / pending guardian | Two-step rotation. SAFE. |
| `accept_guardian` (892-897) | Exact pending guardian | Config / guardian, clear pending | Wrong caller/replay reverts. SAFE. |
| `transfer_protocol_ownership` (900-905) | Owner; nonzero address | Config / pending owner | Two-step transfer; pending can be overwritten. SAFE. |
| `accept_protocol_ownership` (908-913) | Exact pending owner | Config / owner, clear pending | Wrong caller/replay reverts. SAFE. |
| `set_withdrawal_cooldown` (916-922) | Owner; 1 second to 30 days | Config / cooldown | Affects future withdrawal requests; invalid bounds revert. SAFE. |
| `set_bonds` (925-930) | Owner | Config / report and challenge bonds | Report bond is snapshotted; challenge bond is live for active cases (F-08). |
| `set_incident_windows` (933-950) | Owner; each configured within bounds | Config / three windows | Future Incidents snapshot values; active Incidents unaffected. SAFE. |
| `register_provider` (956-999) | Anyone; nonempty bounded name | Counters, provider/vault/stats maps / new records; no value | New owner is sender; monotonic ID; duplicate/replay creates a new Provider. SAFE; spam is possible. |
| `update_provider_metadata` (1002-1009) | Provider owner | Provider / URI/hash/timestamp | Wrong owner/invalid length reverts; repeat overwrites metadata. SAFE. |
| `transfer_provider_control` (1012-1017) | Provider owner; nonzero new owner | Provider / pending owner/timestamp | Two-step; existing owner can overwrite pending. SAFE. |
| `accept_provider_control` (1020-1026) | Exact pending owner | Provider / owner, clear pending | Wrong caller/replay reverts. SAFE. |
| `create_service` (1032-1063) | Provider owner; bounded nonempty type/name | Service map/counter | New active Service tied to provider; no value. SAFE. |
| `update_service_metadata` (1066-1074) | Owner of service's Provider | Service / URI/hash/timestamp | Wrong owner/invalid length reverts. SAFE. |
| `pause_service` (1077-1083) | Provider owner; service active | Service / paused | Stops new sales through `_pact_sellable`; replay reverts. SAFE. |
| `resume_service` (1086-1092) | Provider owner; service paused | Service / active | Re-enables sales; replay/wrong state reverts. SAFE. |
| `retire_service` (1095-1101) | Provider owner; not already retired | Service / retired | Stops new sales; historical claims remain evaluable. SAFE. |
| `create_pact_draft` (1107-1156) | Provider owner of service | Pact/terms/accounting maps/counter | Validates ranges but not all threshold bounds; draft can be edited. SAFE with F-12. |
| `update_pact_draft` (1158-1191) | Pact Provider owner; status DRAFT | Pact terms | Frozen/active terms cannot be changed; repeat only while draft. SAFE. |
| `publish_pact` (1193-1204) | Provider owner; sales not paused; DRAFT | Pact/terms | Freezes terms and activates Pact; replay/state errors revert. SAFE. |
| `create_pact_revision` (1206-1256) | Provider owner; parent published | New Pact/terms/accounting/counter | New ID; old Pact/Coverages unchanged. SAFE. |
| `pause_pact_sales` (1258-1264) | Pact Provider owner; active | Pact / paused | Stops new sales; existing Coverage unaffected. SAFE. |
| `resume_pact_sales` (1266-1272) | Pact Provider owner; paused | Pact / active | Re-enables sales; state guard. SAFE. |
| `retire_pact` (1274-1280) | Pact Provider owner; not retired | Pact / retired | Stops new sales; historical Coverage remains. SAFE. |
| `deposit_capital` (1286-1297) | Provider owner; payable value > 0 | Vault/stats / total capital and deposits | Value increases capital; repeat is additive; insufficient/zero reverts. SAFE. |
| `allocate_capital` (1299-1310) | Pact Provider owner; amount > 0 and free capacity | Vault/Pact allocation | Moves free to Pact allocation; over-allocation reverts; repeat additive within capacity. SAFE. |
| `deallocate_capital` (1312-1326) | Pact Provider owner; amount > 0 and Pact unreserved allocation | Pact/vault allocation | Cannot deallocate reserved amount; repeat guarded by current balance. SAFE. |
| `request_capital_withdrawal` (1328-1339) | Provider owner; amount > 0, no pending, free capacity | Vault / pending amount/unlock time | Locks free capacity for cooldown; duplicate pending reverts. SAFE. |
| `cancel_capital_withdrawal` (1341-1348) | Provider owner; pending > 0 | Vault / clear pending | Reversible before execute; replay reverts. SAFE. |
| `execute_capital_withdrawal` (1350-1363) | Provider owner; pending > 0 and cooldown elapsed | Vault / reduce total, clear pending; credits sender | Reserved/allocated solvency rechecked; repeat no pending reverts. SAFE subject to F-06 on later credit withdrawal. |
| `buy_coverage` (1456-1506) | Anyone; active Pact/service, slippage, payment >= premium, capacity | Pact/vault/Coverage/stats/credits; payable | Reserves full limit, snapshots terms/quote, credits fee/refund; duplicate purchase creates a new Coverage. SAFE for backing. |
| `cancel_pending_coverage` (1508-1512) | Buyer check, then unconditional error | No state/value | Always reverts; F-11. |
| `expire_coverage` (1514-1520) | Permissionless; active and `now >= end` | Coverage / EXPIRED | No reserve release; repeat/status error reverts. SAFE. |
| `release_earned_premium` (1531-1548) | Permissionless; no open claims and end/deadline elapsed | Coverage/vault/Pact/credits | Credits provider share once; releases remaining reserve once; replay flags prevent duplication. SAFE. |
| `open_incident` (1554-1609) | Anyone; valid service, nonempty bounded summary, ordered window, payable bond | Incident/evidence/counter/credits | Permissionless report; evidence optional; extra payment credited; report bond always later refunded; F-01/F-04/F-07. |
| `attach_incident_report` (1611-1626) | Permissionless; Incident OPEN and before evidence deadline | Evidence array/map/counter | Free append; cap 32; no duplicate/provenance control; F-01/F-04. |
| `acknowledge_incident` (1628-1634) | Incident Provider owner; OPEN | Incident / acknowledged flag | Repeat harmless; acknowledgement is not used as an admission. SAFE. |
| `submit_provider_statement` (1636-1645) | Incident Provider owner; OPEN and before deadline | Evidence array/map/counter | Free append; cap 32; repeat allowed. SAFE with F-04 resource risk. |
| `seal_evidence_window` (1647-1654) | Permissionless; OPEN and `now >= deadline` | Incident / EVIDENCE_SEALED, sealed timestamp | One-way; repeat/state/deadline errors revert. SAFE. |
| `submit_evidence` (1708-1725) | Permissionless; OPEN, before deadline, valid type/URI/hash | Evidence array/map/counter | Free append; cap 32; arbitrary content/description drives F-01/F-02/F-04. |
| `resolve_incident` (2256-2271) | Permissionless; OPEN/SEALED and evidence deadline closed | Nondet reads; then Resolution/Incident | LLM/web consensus required; malformed/disagreement fails; preliminary challenge window; F-01/F-02/F-03/F-05. |
| `challenge_incident` (2277-2323) | Permissionless; PRELIMINARY, before deadline, one round, payable current bond | Challenge/evidence/Incident/credits | Stores one challenge; overpayment refund; bond later goes challenger or treasury; F-08 and oracle risks. |
| `submit_challenge_evidence` (2325-2342) | Permissionless; CHALLENGED and before challenge evidence deadline | Evidence array/map/counter | Free append; cap 16; F-04 resource risk. |
| `resolve_challenge` (2344-2369) | Permissionless; CHALLENGED, evidence deadline closed, unresolved challenge | Nondet reads; Resolution/Challenge/Incident/credits | Replaces facts, refunds/forfeits bond, transitions challenge-resolved; no second challenge; F-01/F-02/F-03/F-05. |
| `finalize_incident` (2395-2423) | Permissionless; preliminary challenge deadline elapsed or challenge resolved | Resolution/Incident/stats/credits | One-way finalization; refunds report bond once; repeat rejected by both state guards. SAFE after oracle/liveness findings. |
| `file_claim` (2526-2547) | Coverage buyer; not released, before deadline, service/observed overlap, duplicate key absent | Claim/Coverage/index/counter | Creates one pending claim and increments open claims; repeat exact pair rejected. SAFE with F-07 temporal input. |
| `settle_claim` (2594-2634) | Permissionless; claim pending, Incident/Resolution finalized | Claim/Coverage/Pact/vault/stats/credits | Deterministic eligibility/payout; ineligible becomes terminal; positive payout debits capital and credits claimant; replay rejected. SAFE for arithmetic/backing; uses F-01/F-02/F-03 facts. |
| `withdraw_credit` (2636-2642) | Credit owner; amount > 0 and sufficient balance | Credit ledger; external GEN message | Internal debit once then transfer; child failure has no recovery, F-06. |

### View-method matrix

| View method (lines) | Input / return | Source of truth and failure behavior |
|---|---|---|
| `quote_coverage` (L1453) | Pact ID, limit, duration -> quote dict | Recomputes terms/premium/deadlines from Pact storage; unknown Pact, invalid range, or inactive terms revert. It can quote a non-sellable Pact; purchase still rechecks sellability. |
| `can_finalize_incident` (L2391) | Incident ID -> boolean | Reads Incident/Resolution/Challenge deadlines and returns the terminal eligibility predicate; unknown Incident reverts. |
| `calculate_claim_payout` (L2572) | Claim ID -> payout/eligibility dict | Recomputes `_calc_existing_claim` from current stored facts; unknown Claim or missing Coverage/Incident/Pact/Resolution reverts. It does not itself require a pending Claim (see F-12). |
| `preview_claim_payout` (L2576) | Coverage ID, Incident ID -> payout/eligibility dict | Recomputes `_payout_from_parts` from current Coverage, Incident, Pact, and finalized Resolution; unknown IDs or unfinalized/missing Resolution revert. |
| `can_settle_claim` (L2585) | Claim ID -> boolean | Checks Claim status and finalized Incident/Resolution; unknown Claim returns false rather than reverting. |
| `get_protocol_config` (L2649) | None -> config dict | Returns current ProtocolConfig; always succeeds after construction. It is live config, not historical Incident/Coverage snapshots. |
| `get_counters` (L2676) | None -> counter dict | Returns monotonic storage counters; always succeeds. |
| `get_provider` (L2688) | Provider ID -> provider dict | Reads Provider storage; unknown/nonexistent Provider reverts. |
| `get_provider_vault` (L2702) | Provider ID -> vault/free-capacity dict | Reads ProviderVault and derives free capacity; unknown Provider reverts. |
| `get_provider_stats` (L2716) | Provider ID -> stats dict | Reads ProviderStats; unknown Provider reverts. Counters reflect recorded transitions, not necessarily every user action (F-12). |
| `get_service` (L2739) | Service ID -> service dict | Reads Service storage; unknown/nonexistent Service reverts. |
| `get_pact` (L2754) | Pact ID -> pact dict | Reads Pact storage and lifecycle status; unknown Pact reverts. |
| `get_pact_terms` (L2770) | Pact ID -> frozen terms dict | Returns stored PactTerms; unknown Pact reverts. |
| `get_pact_capacity` (L2775) | Pact ID -> allocated/reserved/available dict | Reads Pact allocation/reserve maps and derives available amount; unknown Pact reverts. |
| `get_coverage` (L2790) | Coverage ID -> Coverage dict | Reads Coverage storage, including remaining limit/open claims; unknown Coverage reverts. |
| `get_incident` (L2816) | Incident ID -> Incident dict | Reads Incident storage; unknown Incident reverts. |
| `get_incident_resolution` (L2844) | Incident ID -> exists flag/resolution dict | Reads Resolution storage; unknown Incident reverts, while an Incident without a stored resolution returns `exists=false`. |
| `get_evidence` (L2879) | Evidence ID -> evidence dict | Reads submitted Evidence metadata and the committed hash; no post-fetch status is stored; unknown Evidence reverts. |
| `get_incident_evidence_ids` (L2895) | Incident ID -> evidence ID list | Reads the incident DynArray; unknown Incident reverts. The list is append-only and bounded by the source caps. |
| `get_challenge` (L2908) | Incident ID -> exists flag/challenge dict | Reads Challenge storage; unknown Incident reverts, while an Incident without a challenge returns `exists=false`. |
| `get_claim` (L2936) | Claim ID -> Claim dict | Reads Claim storage; unknown Claim reverts. |
| `get_claimable_balance` (L2951) | Address -> credit amount | Reads the internal credits map; unseen addresses return zero and do not revert. |

## 10. State Machine Review

### Pact

`DRAFT -> ACTIVE -> PAUSED -> ACTIVE`, with `ACTIVE/PAUSED -> RETIRED`. Draft terms are mutable only in `DRAFT`; publication sets `frozen=True`. Revisions create a new Pact ID and do not mutate old Pact terms. Pause/retire affects future sales, not historical Coverage.

### Service

`ACTIVE -> PAUSED -> ACTIVE`; `ACTIVE/PAUSED -> RETIRED`. Service status gates sales but not historical incidents/claims. No path reopens a retired Service.

### Coverage

`ACTIVE -> EXPIRED -> RELEASED`. `expire_coverage` is permissionless and only changes status. `release_earned_premium` requires end/deadline elapsed and `open_claims == 0`; it pays provider share once and releases reserve once. There is no real pending-purchase state, so cancellation is dead.

### Incident

`OPEN -> EVIDENCE_SEALED -> PRELIMINARY -> FINALIZED` or `PRELIMINARY -> CHALLENGED -> CHALLENGE_RESOLVED -> FINALIZED`.

`resolve_incident` can combine sealing with first resolution after the evidence deadline. `finalize_incident` is permissionless after the challenge deadline or challenge resolution. No finalization path exists without a successful resolution object; this is F-05.

### Challenge

At most one challenge because `MAX_CHALLENGE_ROUNDS=1`. Challenge evidence is append-only and bounded by count. A challenge result replaces the stored resolution before finalization; after challenge resolution there is no further challenge.

### Claim

`PENDING_RESOLUTION -> SETTLED` for positive eligible payout, or `PENDING_RESOLUTION -> INELIGIBLE` for all other finalized outcomes. Both are terminal and prevent replay. `open_claims` is decremented in both terminal paths.

### Withdrawal

`no pending -> pending -> no pending` by cancellation or execution. Pending amount is excluded from free capital, and execution rechecks free capital. The state machine ends at an internal credit; external withdrawal is separately vulnerable to child-message failure (F-06).

## 11. GenLayer / Nondeterministic Review

### Leader and validator behavior

- `_adjudicate` fetches every evidence item, hashes response bytes, builds a prompt, requests JSON, validates schema, applies fetch overrides, and derives duration.
- `validator_fn` checks that the leader result is `gl.vm.Return`, independently reruns the entire `leader_fn`, and compares selected fact fields.
- Storage writes occur after `run_nondet` in `_apply_resolution`, `resolve_incident`, and `resolve_challenge`; no explicit storage write or message emission occurs inside `_adjudicate`.
- Malformed JSON, missing fields, invalid enums, wrong booleans, bad times, bad metric ranges, unknown evidence IDs, and usable/unusable overlap fail closed.
- Unknown metrics are reset to zero and disabled Pact clauses are ignored by `_matched_clauses`.

### Equivalence findings

The validator performs more than JSON-schema checking, which is positive. However, it reruns the same LLM task over the same attacker-controlled inputs, and the accepted leader result remains financially authoritative. F-03 shows that the time tolerance can accept materially different financial intervals. The scope case bug in F-09 can produce unnecessary disagreements.

The current official documentation recommends custom validators use source-grounded independent verification and documents `gl.vm.run_nondet`/`run_nondet_unsafe` behavior. See [Equivalence Principle](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle) and [Non-determinism](https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism).

### Prompt injection

The prompt contains explicit instructions to treat evidence, descriptions, summaries, URIs, and challenges as untrusted. Evidence is delimited with `BEGIN_UNTRUSTED_EVIDENCE` markers, and financial payout math is excluded from the prompt. These are useful mitigations.

They are not a complete boundary:

- User-controlled evidence content can spoof delimiters and include arbitrary instructions.
- Evidence descriptions are attacker-controlled and explicitly offered as a source of metrics.
- Service name/type are provider-controlled prompt inputs and are not placed in an untrusted delimiter.
- The prompt does not require every financial fact to cite a successful evidence item.
- Both leader and validator receive the same attacker-controlled text, so agreement does not neutralize prompt injection or fabricated factual claims.

The official [Prompt Injection](https://docs.genlayer.com/developers/intelligent-contracts/security-and-best-practices/prompt-injection) guidance recommends restricting inputs and outputs; F-01/F-02 remain.

## 12. Evidence Integrity

| Check | Result |
|---|---|
| Submitted evidence hash format | PASS for evidence paths: normalized, 64 hex characters, optional `0x` stripped |
| Fetched-body SHA-256 | PASS: raw bytes are hashed before UTF-8 display conversion |
| Changed URI body | Detected as `hash_mismatch` |
| HTTP/fetch failure | Isolated per evidence item; item is not placed in usable IDs |
| One failed source poisoning all IDs | PASS at ID-list level; FAIL at prompt/fact level because failed content remains in prompt (F-02) |
| All-source failure | Override forces `INCONCLUSIVE`/`INSUFFICIENT` if no usable item remains |
| Empty body | Hash-valid empty bytes can be marked usable; no deterministic nonempty-content rule |
| Huge body | Full body is fetched/hashed before 4,000-character prompt truncation (F-04) |
| Evidence after deadline | Blocked by OPEN/status and strict `< deadline` checks |
| Challenge evidence after deadline | Blocked by CHALLENGED/status and strict `< deadline` checks |
| URI mutability | Hash mismatch detects content change but does not establish publisher authenticity |

The hash covers response body bytes only. It does not cover the on-chain description, submitter identity, HTTP provenance, or source signature.

## 13. Claim + Settlement Review

### Deterministic threshold behavior

`_matched_clauses` correctly implements:

- availability violation when known and observed availability is below the threshold;
- p95 violation when known and observed p95 is above the threshold;
- error-rate violation when known and observed error rate is above the threshold;
- block-lag violation when known and observed lag is above the threshold;
- disabled clauses ignored;
- unknown metrics ignored, not treated as violations;
- exact/case-normalized scope matching, with empty Pact scope acting as wildcard;
- strict interval overlap;
- minimum incident duration;
- `INCIDENT_CONFIRMED`, Provider/Shared fault, maintenance exclusion, and chain-failure gates.

The requested differential is reproduced: for `p95=300`, Pact threshold 150 matches `P95_LATENCY`, while threshold 500 does not. No LLM verdict is consulted by `_payout_from_parts`.

### Filing and duplicate controls

`file_claim` requires the Coverage buyer, a non-released Coverage, current time at or before the claim deadline, service equality, observed-window overlap, and an unused `coverage_id:incident_id` key. The claim may be filed before Incident finalization, which correctly locks the Coverage reserve through `open_claims`.

### Payout arithmetic

Payout is `floor(remaining_limit * max_payout_bps / 10000)`, less a round-up deductible, halved for Shared fault, then capped by remaining limit and `reserved_amount`. It is credited only after `_debit_provider_capital` decrements Provider/Pact capital and reserve. Zero payout is terminally ineligible, not a successful settlement.

### Identified weaknesses

F-01/F-02/F-03 affect the inputs to this otherwise deterministic process. The maintenance term binding gap is F-10. Settlement replay and reserve arithmetic themselves passed review.

## 14. Value Transfer Review

- Payable methods correctly read `gl.message.value`, require required bond/premium/capital amounts, refund overpayment through credits, and do not directly transfer user-supplied value to arbitrary recipients.
- Protocol fees are credited once at purchase; provider share is credited once after release conditions.
- Payouts, refunds, bonds, and capital withdrawals use the credit ledger rather than immediate child calls.
- `withdraw_credit` debits before `_send_native`; this prevents same-ledger double withdrawal but creates F-06 if the external child transfer fails.
- The current official docs state that Studio balances are simulated and that external messages to the chain layer execute at finalization. No state-changing withdrawal was attempted.
- Source uses `_NativeRecipient(...).emit_transfer(amt)` positionally (line 616), while current docs show the keyword form `emit_transfer(value=...)`. The certified source uses an older pinned `py-genlayer` runtime, so this possible ABI/signature incompatibility was not counted as a confirmed finding without the exact runner. It must be tested against the exact pin before production withdrawals are trusted.

## 15. Governance / Admin Review

| Area | Result |
|---|---|
| Owner transfer | Two-step, nonzero pending owner; no arbitrary caller takeover found |
| Guardian transfer | Two-step, nonzero pending guardian |
| Treasury rotation | Two-step, nonzero pending treasury; old credits remain assigned to old address |
| Pause | Owner or guardian can pause new sales; only owner can resume; recovery paths remain callable |
| Protocol fee | Hard capped at 1,000 bps; Coverage fee split is snapshotted at purchase |
| Pact terms | Published terms cannot be changed; revisions use new Pact IDs |
| Incident windows | Snapshotted into Incident; active deadlines are not changed by window updates |
| Bonds | Report bond snapshotted; challenge bond is not (F-08); no bond upper bound |
| Arbitrary slash | No owner/guardian method found to slash Provider capital or confiscate reserved customer collateral |
| Resolution rewrite | Not possible after finalization; challenge is one round before finalization |
| Claim cancellation | No privileged cancellation path found |
| Admin fund theft | Owner can redirect future protocol fees by rotating treasury, which is inherent privileged power; no direct withdrawal of Provider/customer reserves found |

A compromised owner/guardian can pause sales, alter future fees/bonds/windows, or transfer governance, but cannot bypass the checked capital/claim/finalization paths through the exposed methods. A compromised guardian cannot resume sales or freeze recovery methods.

## 16. Liveness / DoS

Realistic reachable risks:

- Evidence and Incident spam are permissionless and append-only (F-04).
- An Incident with a filed claim cannot release its Coverage reserve until claim resolution; failed nondeterministic resolution has no fallback (F-05).
- Scope case mismatch can cause avoidable validator disagreement (F-09).
- External URLs may disappear; the code isolates a source failure but still depends on the LLM call and validator agreement to produce the all-failure `INCONCLUSIVE` output.
- Report bonds are refunded regardless of fact outcome, so they do not create a lasting anti-spam cost. `report_bond=0` makes evidence-free Incident spam free apart from transaction/network costs.

No reachable path was found for an arbitrary caller to fill another user's Coverage reserve, alter another user's Pact terms, or bypass an already-finalized lifecycle transition.

### Timestamp and deadline audit

`_now()` first calls `gl.vm.get_timestamp()`, then tries `gl.message.raw["datetime"]`, and finally falls back to host `datetime.now(timezone.utc)`. Current GenLayer transaction-context documentation describes the VM timestamp as deterministic for a transaction, so the host-clock fallback was not treated as a reachable High finding on the certified deployment. Because the exact pinned runner was unavailable locally, that fallback remains an exact-runtime regression item.

Boundary behavior is consistent and intentional in the reviewed paths: Coverage expiry and evidence/challenge sealing use `now >= deadline`; evidence/challenge submission uses `now < deadline`; claim filing uses `now <= claim_deadline`; Coverage starts immediately at the quote transaction timestamp. The material temporal defects are instead the accepted zero-length incident window, future/unbounded observed windows (F-07), and the 300-second resolution tolerance crossing claim boundaries (F-03).

### Storage and serialization audit

All persistent records are `@allow` dataclasses behind `TreeMap`/`DynArray` declarations. Mutated dataclass values are written back on the reviewed paths, and DynArray append is used for incident evidence. Evidence response bodies are not stored on-chain; only bounded metadata and hashes are stored. String inputs have explicit length caps, and ordinary/challenge evidence counts are capped. No lost write-back, nested-aliasing, or malformed serialization path was reproduced. Permissionless registry creation and append-only evidence remain the practical storage/resource-spam risks described in F-04.

## 17. Test Assessment

### Existing tests

No test files, package manifest, lockfile, or test configuration were present in the repository. No repository test suite could be run.

### Audit checks executed

- Python AST parse and public API inventory: PASS.
- Source SHA before/after: PASS.
- Temporary arithmetic/equivalence/evidence/prompt-bound POC: 6 assertions/checks PASS.
- Live chain ID: PASS (`61997`).
- Live deployed source byte equality: PASS.
- Live schema inventory: PASS (74/22/52/4 and method-name set match).
- Exact-pin direct deployment: NOT RUN/NOT AVAILABLE. The workspace has no importable `genlayer` module; `genlayer-test 0.29.2` / `genlayer-py 0.16.3` existed only in `/tmp/faultpact-audit`, without the certified dependency hash and incompatible with this source's `genlayer.types` import path.

The temporary POC is outside the repository at `/tmp/faultpact-audit/pocs.py`; it is not a production test or a modified contract.

## 18. Live Read-Only Verification

| Check | Result |
|---|---|
| `eth_chainId` | `0xf22d` = `61997` |
| `gen_getContractCode` | Returned base64 source; decoded length 117,324 bytes; exact byte match and expected SHA |
| `gen_getContractSchema` | 74 methods, 22 views, 52 writes, 4 payables; names match source inventory |
| `gen_getContractState` | RPC returned method-not-found; not used to claim state consistency |
| State-changing calls | None |

## 19. Integration Warnings for Frontend/Backend

- Treat `quote_coverage.sellable` separately from quote arithmetic; quotes can be returned for inactive/draft Pact IDs, but `buy_coverage` rejects them.
- The installed GenLayer CLI defaults to `https://studio.genlayer.com/api` / chain `61999`; the certified deployment is on the explicit Studio Development Preview RPC `https://studio-dev.genlayer.com/api` / chain `61997`.
- A Coverage starts immediately. `now == claim_deadline_ts` permits filing; `now == evidence_deadline` or `now == challenge_deadline` rejects new evidence/challenges.
- `expire_coverage` does not release reserve. A later `release_earned_premium` call is required after end, claim deadline, and zero open claims.
- Claims must be filed before the Coverage claim deadline even if the Incident has not resolved; filing first is how collateral remains locked.
- Resolution is one canonical Incident fact set reused by all Pact evaluations. Frontends must not submit Pact-specific verdicts to the AI layer.
- Resolution facts are preliminary until finalization. Claims cannot settle from a preliminary or challenge-resolved-but-unfinalized Incident.
- `calculate_claim_payout` is a recomputation view and is not an authorization or settlement receipt. Use Claim status and `can_settle_claim` for actionability.
- `get_provider_stats.total_claims` counts successful settlements, not all filed/ineligible claims; do not interpret it as total filed claims.
- Provider share is credited to the Provider's current owner at release, not necessarily the owner at Coverage purchase.
- Credits require a separate `withdraw_credit`; a successful internal credit does not prove the external native transfer has completed.
- `cancel_pending_coverage` is unusable in this source and always reverts.
- Evidence descriptions, service names/types, URLs, and response bodies are attacker-controlled prompt inputs. Client-side filtering is not a security boundary.
- The integration must surface `INCONCLUSIVE`, unresolved, challenge, and external-transfer failure states instead of assuming every submitted transaction reaches a terminal financial outcome.

## 20. Final Verdict

**AUDIT FAIL — CRITICAL/HIGH FINDINGS PRESENT**

Critical findings: 0.<br>
High findings: F-01, F-02, F-03.<br>
Medium findings: F-04, F-05, F-06, F-07.<br>
Low findings: F-08, F-09, F-10.<br>
Informational findings: F-11, F-12.

The source/deployment integrity and capital accounting controls pass the reviewed invariants, but the current evidence-to-fact boundary and time-tolerant equivalence comparator are not safe for meaningful economic value without remediation and exact-runtime regression testing.
