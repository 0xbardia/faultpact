# FaultPact V1 Phase 0.2 Independent Re-Audit

Audit date: 2026-09-21 UTC

Scope: read-only source, schema, tooling, local current-SDK execution, independent
PoCs, and live read-only Studio Dev verification. No contract source, tests,
deployment state, or existing report was modified.

## 1. Executive Summary

Overall: **PASS WITH ACCEPTED LIMITATIONS**

The hardened candidate removes the three original High-risk paths that could
produce a false payout from untrusted evidence, invalid evidence, or approximate
financial time consensus. I found no Critical or High vulnerability in the
reachable settlement path.

Two Medium limitations remain:

1. F-04 is only partially fixed. Supplemental evidence has separate storage
   capacity and prompt selection, but the GenLayer web API has no response-size
   argument in the pinned SDK. The contract reads the complete response before
   truncating it. A selected multibyte supplemental body can also make the final
   prompt-size guard revert resolution. The permissionless timeout path contains
   this as a bounded liveness denial and eventually terminates claims, but it does
   not preserve ordinary resolution liveness.
2. F-06 remains the documented GenLayer external-transfer limitation. Credit is
   debited before an external EOA transfer and there is no application-level
   acknowledgement/recovery path if that external transfer later fails. The
   restriction to `sender == origin` prevents an arbitrary recipient or another
   account from forcing a victim's withdrawal.

One Low governance risk remains: reporter authorization is an owner-controlled
address allowlist, not an on-chain proof of monitoring independence. A protocol
owner who also controls a Provider can authorize itself. This is a privileged
governance trust assumption, not an unprivileged quorum bypass; deployment
governance must keep the owner and authoritative reporters independent.

Final recommendation: **FAULTPACT V1 RE-AUDIT PASS WITH ACCEPTED LIMITATIONS —
READY FOR CONTRACT FREEZE**. The F-04 and F-06 limitations must remain visible to
application integration and the next independent audit.

## 2. Source Integrity

| Item | Result |
|---|---|
| Local path | `contracts/FaultPact.py` |
| Expected SHA-256 | `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e` |
| Actual SHA-256 before audit | `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e` |
| Actual SHA-256 after audit | `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e` |
| Source byte length | `141351` |
| Contract class | `FaultPact` |
| Dependency pin | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| Contract modified | **NO** |

The final hash was recomputed after every audit action. It still matches the
required hardened candidate hash. The repository has no `.git` metadata, so a
`git status` comparison was unavailable. Pre-existing Python `__pycache__`
artifacts were not touched; the only intentional in-repository artifact created
by this audit is this report. Independent PoCs and read-only scripts were kept
under `/tmp/faultpact-phase-0-2/`.

## 3. Deployment Integrity

| Item | Result |
|---|---|
| RPC | `https://studio-dev.genlayer.com/api` |
| `eth_chainId` | `0xf22d` = `61997` |
| Expected address | `0xeb858957e3C426597245f6b59E260f1cC556Bf13` |
| Deployment transaction | `0x980b1a8949173601c80a2bd2b4a15890ad4b8582e763983f895e48ab8f057554` |
| Deployment receipt | Found, status `0x1` |
| Deployed source match | **YES**, byte-for-byte |
| Deployed source SHA-256 | `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e` |
| Deployed source byte length | `141351` |
| Schema match | **YES**, exact public method/readonly/payable/parameter comparison |

The earlier certification listed `141349` “on-chain source bytes”. The RPC client
returned `141349` JavaScript UTF-16 characters; the fetched UTF-8 source bytes
are `141351`, exactly equal to the local file. This is a reporting-unit error,
not a deployed-source mismatch.

The independently extracted local AST and deployed schema both contain:

- 78 public methods
- 23 readonly views
- 55 writes
- 4 payable writes
- 12 constructor parameters

All method names, view/write classification, payable classification, parameter
names/types, return types, and constructor fields matched. No state-changing live
transaction was sent during this re-audit.

## 4. Final Contract Inventory

### Dataclasses

`ProtocolConfig`, `Provider`, `ProviderVault`, `ProviderStats`, `Service`,
`PactTerms`, `Pact`, `Coverage`, `Incident`, `Evidence`, `Resolution`,
`Challenge`, and `Claim` (13 total).

### Storage

The contract declares 27 storage roots/fields: `config`; seven next-ID
counters; `providers`, `vaults`, `stats`, `services`, `pacts`, `pact_terms`,
`pact_allocated`, `pact_reserved`, `coverages`, `incidents`,
`incident_evidence_ids`, `incident_claim_ids`, `evidence`, `resolutions`,
`challenges`, `claims`, `claim_index`, `credits`, and
`authorized_reporters`.

### Read-only views (23)

`quote_coverage`, `can_finalize_incident`, `calculate_claim_payout`,
`preview_claim_payout`, `can_settle_claim`, `get_protocol_config`,
`is_authorized_reporter`, `get_counters`, `get_provider`, `get_provider_vault`,
`get_provider_stats`, `get_service`, `get_pact`, `get_pact_terms`,
`get_pact_capacity`, `get_coverage`, `get_incident`,
`get_incident_resolution`, `get_evidence`, `get_incident_evidence_ids`,
`get_challenge`, `get_claim`, and `get_claimable_balance`.

### Writes (55; payable in parentheses)

`pause_new_sales`, `resume_new_sales`, `set_protocol_fee`, `set_treasury`,
`accept_treasury`, `set_guardian`, `accept_guardian`,
`transfer_protocol_ownership`, `accept_protocol_ownership`,
`set_withdrawal_cooldown`, `set_bonds`, `set_incident_windows`,
`set_resolution_policy`, `authorize_reporter`, `revoke_reporter`,
`register_provider`, `update_provider_metadata`, `transfer_provider_control`,
`accept_provider_control`, `create_service`, `update_service_metadata`,
`pause_service`, `resume_service`, `retire_service`, `create_pact_draft`,
`update_pact_draft`, `publish_pact`, `create_pact_revision`,
`pause_pact_sales`, `resume_pact_sales`, `retire_pact`,
`deposit_capital` (payable), `allocate_capital`, `deallocate_capital`,
`request_capital_withdrawal`, `cancel_capital_withdrawal`,
`execute_capital_withdrawal`, `buy_coverage` (payable), `expire_coverage`,
`release_earned_premium`, `open_incident` (payable), `attach_incident_report`,
`acknowledge_incident`, `submit_provider_statement`, `seal_evidence_window`,
`submit_evidence`, `resolve_incident`, `challenge_incident` (payable),
`submit_challenge_evidence`, `resolve_challenge`, `finalize_incident`,
`finalize_inconclusive_timeout`, `file_claim`, `settle_claim`, and
`withdraw_credit`.

## 5. Original Finding Re-Test

| Finding | Old severity | Phase 0.1 claim | Independent result | Current severity | Notes |
|---|---:|---|---|---:|---|
| F-01 | High | FIXED | **FIXED for untrusted/supplemental evidence; governance trust caveat** | Low caveat only | Authenticated submission identity, structured schema, unique quorum, and fact support are enforced. |
| F-02 | High | FIXED | **FIXED** | — | Failed/hash-invalid/schema-invalid content is status-only in factual evidence input. |
| F-03 | High | FIXED | **FIXED** | — | Exact interval comparison and derived duration are enforced. |
| F-04 | Medium | FIXED | **PARTIALLY FIXED** | Medium | Separate slots and prompt limits exist; full response fetch and prompt-DoS residual remain. |
| F-05 | Medium | FIXED | **FIXED** | — | Permissionless deadline fallback is terminal and releases pending claims. |
| F-06 | Medium | ACCEPTED LIMITATION | **ACCEPTED GENLAYER RUNTIME LIMITATION** | Medium | Self-only EOA restriction limits blast radius; atomic recovery is unavailable. |
| F-07 | Medium | FIXED | **FIXED** | — | Future and overlong observation windows revert onchain. |
| F-08 | Low | FIXED | **FIXED** | — | Report and challenge bonds are Incident snapshots. |
| F-09 | Low | FIXED | **FIXED** | — | Scope is normalized once and empty scope is rejected. |
| F-10 | Low | FIXED — disabled V1 | **FIXED — disabled V1** | — | No maintenance field or model boolean reaches settlement. |
| F-11 | Informational | FIXED | **FIXED** | — | `cancel_pending_coverage` is absent from source and deployed schema. |
| F-12 | Informational | FIXED | **FIXED** | — | Bounds, stats, terminal views, hashes, and retired-service checks verified. |

## 6. F-01 Evidence Provenance

### Reporter registry and snapshots

`authorized_reporters: TreeMap[Address, bool]` is controlled only by the
protocol owner (`contracts/FaultPact.py:1048-1061`). `_store_evidence`
(`contracts/FaultPact.py:1768-1823`) snapshots both `reporter_authorized` and
`provenance` at submission. Revocation changes later submissions only; it does
not reinterpret an existing Evidence record.

Authoritative provenance requires both an allowed evidence type
(`PROBE_REPORT`, `THIRD_PARTY_MONITOR`, or `CHAIN_REFERENCE`) and an authorized
submitter. All other combinations are supplemental.

### Quorum and support binding

The Incident snapshots `min_authoritative_reporters`. `_supporting_items`
(`contracts/FaultPact.py:2337-2355`) counts distinct serialized submitter
addresses, not evidence IDs, probe IDs, URIs, or bodies. Every payout-bearing
fact is required to have nonempty support IDs in `FACT_SUPPORT_KEYS`. Each ID
must be an Evidence record for the Incident, must be fetched successfully, must
pass SHA-256, must pass authoritative schema validation, must remain
authoritative, and must meet the unique-reporter quorum.

The post-adjudication checks also compare the structured values to the selected
fact: service-bound probe data, normalized region, interval endpoints, fault
domain, incident status, chain-failure flag, and each known metric. Unknown
metrics cannot be silently assigned a value by support text.

### Structured authoritative schema

`_validate_authoritative_payload` (`contracts/FaultPact.py:2171-2239`) requires
the exact `faultpact-probe-v1` key set. It validates service ID, normalized
scope syntax, Incident-bounded timestamps, positive interval, maximum span,
booleans, fault domain, probe ID length, sequence bounds, and metric ranges.
Unknown keys, missing keys, malformed JSON, wrong schema version, wrong service,
wrong time bounds, negative-like values, and out-of-range metrics fail closed.

The contract does not maintain a per-Service region allowlist. The accepted
region is the normalized authoritative region and deterministic claim evaluation
requires it to match the frozen Pact scope, or uses the explicit `global` Pact
token. This is adequate against untrusted customer evidence but leaves the
reporter/governance trust assumption described in Section 14.

### Independent attacks

| Attack | Result |
|---|---|
| Random address submits hash-valid probe JSON | Evidence is supplemental; support validation rejects it. |
| One authorized reporter submits two records | Unique quorum rejects both-record support when quorum is two. |
| Two distinct authorized reporters | Satisfies the configured quorum only when every fact cites both as required. |
| Reporter revoked after old submission | Old Evidence remains authoritative; later submission is supplemental. |
| Missing support IDs | `ERR_FACT_SUPPORT`. |
| Hallucinated/nonexistent ID | `ERR_FACT_SUPPORT`. |
| Cross-Incident ID | ID is absent from the current resolution context; rejected. |
| Duplicate support ID | Rejected during support-list normalization. |
| Invalid/hash-failed/unavailable ID | Fails `ok`, hash, schema, or authoritative checks. |
| Support ID listed as unusable | Actual fetch reconciliation overwrites model status; invalid records cannot pass support validation. |
| Wrong service, region syntax, timestamp, schema, or metric | Structured authoritative validation fails, so it cannot support payout facts. |

The independent PoC `/tmp/faultpact-phase-0-2/independent_pocs.py` separately
reproduced unauthorized-only rejection, same-reporter quorum rejection, and
revocation snapshot semantics.

### Live read-only state

The deployed view state independently showed both reported reporter addresses as
authorized; Evidence 1 and 2 as `AUTHORITATIVE` from distinct submitters;
Evidence 3 and 4 as authoritative at submission but unusable in the finalized
resolution; and Evidence 7 as `SUPPLEMENTAL` with authorization false. The live
Resolution view showed every payout-bearing support list using `[1, 2]`, usable
IDs `[1, 2]`, and unusable IDs `[3, 4]`.

### Verdict

**FIXED against arbitrary/supplemental evidence.** The remaining trust property
is governance: the owner can authorize a provider-controlled reporter. This is
not an unprivileged role escalation because the owner already controls reporter
authorization, quorum, bonds, and treasury configuration.

## 7. F-02 Invalid Evidence Isolation

The fetch path (`contracts/FaultPact.py:2241-2308`) returns no body/content on
HTTP failure, fetch exception, hash mismatch, oversized authoritative body, or
authoritative schema failure. `_adjudicate` (`contracts/FaultPact.py:2431-2550`)
then supplies only fixed tokens such as `HASH_MISMATCH`, `FETCH_FAILED`,
`EVIDENCE_UNUSABLE`, `AUTHORITATIVE_BODY_TOO_LARGE`, or `NOT_SELECTED`.

The invalid item's description is not copied into the factual evidence object.
The invalid body is not copied either. Valid supplemental content is deliberately
available as `SUPPLEMENTAL_VALID_UNTRUSTED` context, but it is never accepted by
`_supporting_items`.

Independent PoC results:

- A body changed after hash commitment produced `HASH_MISMATCH`; poison bytes
  and the poison description were absent from the captured prompt.
- A hash-valid malformed body cited as the p95 support ID caused
  `ERR_FACT_SUPPORT`.

The challenge path uses the same `_adjudicate` and support validation, so it does
not provide a weaker evidence route. The remaining prompt injection surface is
untrusted valid supplemental text and bounded Incident/challenge prose. It is
structurally labeled and cannot establish a financially material fact without
valid authoritative support. **Verdict: FIXED.**

## 8. F-03 Consensus Time Safety

`_decision_fields_match` (`contracts/FaultPact.py:2138-2168`) requires exact
equality for `incident_start`, `incident_end`, and derived `duration_seconds`.
It also compares every known metric and other financially material decision
field. No time-tolerance constant remains in the contract.

`_validate_resolution_schema` requires the interval to be ordered and inside the
Incident observation window, then computes `duration_seconds = end - start`.
The model's independent duration field is not required or trusted.

The independent PoC rejected both a one-second endpoint difference and the old
class of `[900,950]` versus `[1000,1000]` intervals. It also verified that a
wrong model duration is replaced by deterministic subtraction. The local
permanent suite separately covers exact consensus and Coverage-boundary
disagreement.

Coverage overlap, minimum incident duration, and payout all consume the stored
exact interval and derived duration. **Verdict: FIXED.**

## 9. F-04 Resource / Spam

The implementation has real separation:

- authoritative evidence capacity: 8;
- supplemental evidence capacity: 24;
- maximum authoritative records per reporter: 4;
- maximum supplemental records per submitter: 4;
- deterministic selection: all authoritative plus the first four supplemental;
- description limit: 512 characters at storage;
- authoritative body limit after fetch: 16384 bytes;
- aggregate prompt evidence limit: 24576 bytes;
- challenge evidence cap: 16.

An attacker cannot fill the primary supplemental budget and consume the primary
authoritative slots. The independent PoC and permanent tests confirmed that four
supplemental records do not prevent later authoritative submission and that a
fifth record from one submitter is rejected.

### Residual denial of service

The pinned SDK's `gl.nondet.web.get(url)` accepts URL, headers, and sign options;
it has no response-size control. `_fetch_one_evidence` obtains the complete body
before applying the 4096-character supplemental truncation and the 16384-byte
authoritative check. Therefore a remote endpoint can impose fetch/memory/runtime
work before the contract can reject or truncate the body.

There is a second, reproducible liveness issue. A selected supplemental body of
4096 multibyte characters is truncated by characters, then JSON serialization
escapes it. The final prompt exceeds `MAX_PROMPT_EVIDENCE_BYTES + 8192`, and
`resolve_incident` reverts with `ERR_PROMPT_SIZE`. An attacker can submit such a
valid-hash supplemental record during the evidence window. The record cannot be
removed, so ordinary resolution remains unavailable until the timeout fallback.

Challenge evidence uses a shared 16-record cap rather than separate authoritative
and supplemental challenge budgets. Sybil submitters can fill that cap and block
new challenge evidence, although existing primary authoritative evidence remains
required for any payout-bearing facts.

This is a liveness/resource issue, not a false-payout or insolvency path. The
permissionless timeout fallback eventually produces `INCONCLUSIVE`, terminates
pending claims, and permits reserve release. **Verdict: PARTIALLY FIXED;
Medium accepted limitation.**

## 10. F-05 Liveness Fallback

`finalize_inconclusive_timeout` (`contracts/FaultPact.py:2800-2900`) is
permissionless and checks the Incident's snapshotted `resolution_deadline`.
With no valid resolution it creates an `INCONCLUSIVE` resolution with no metrics
and no support IDs. With an unresolved challenge it creates an inconclusive
challenge result and handles the challenge bond once.

The fallback then marks pending claims ineligible, decrements each Coverage's
`open_claims` once, finalizes the Incident, refunds the report bond once, and
updates stats without inventing provider-fault facts. Repeated fallback and
normal-finalization attempts are blocked by terminal state. A valid preliminary
resolution is not prematurely overridden; it follows the normal challenge-window
finalization path. A valid challenge resolution is finalized normally.

The independent PoC verified permissionless timeout, terminal claim transition,
reserve release, and repeated-fallback rejection. Live read-only state for
Incident 3 independently showed `FINALIZED`, `INCONCLUSIVE`, Claim 3
`INELIGIBLE`, `open_claims=0`, and Coverage 3 `RELEASED` with zero reserve.
**Verdict: FIXED.**

## 11. F-06 Native Transfer Runtime Limitation

`withdraw_credit` (`contracts/FaultPact.py:3123-3134`) requires a positive amount,
uses only `_sender()` as the recipient, and requires `sender == origin`. It
debits the credit before `_NativeRecipient(...).emit_transfer(...)`.

The current official GenLayer documentation states that external EOA/EVM
transfers execute on finalization and that a failed child transfer does not
automatically return value. It does not provide the parent contract with an
application-level child-transfer acknowledgement/recovery callback suitable for
atomic credit restoration. The relevant documentation is:

<https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers>

The restriction prevents arbitrary recipient selection and means an external
actor cannot force a transfer of somebody else's credit. A failed transfer can
still consume the withdrawing EOA's own credit. The local current-SDK test
simulated this exact runtime behavior and confirmed no second withdrawal could
reuse the credit. Live read-only state and successful receipt artifacts confirm
the documented tiny EOA withdrawals and zero remaining credit; no state-changing
failure experiment was performed during this audit.

**Verdict: ACCEPTED GENLAYER RUNTIME LIMITATION; Medium.** The code does not
advertise arbitrary-recipient recoverability. Treasury, provider, and other
credit recipients must be operational EOAs for this V1 model.

## 12. F-07 Incident Time Validation

`open_incident` (`contracts/FaultPact.py:1654-1720`) enforces:

- `observed_end >= observed_start`;
- strictly positive span;
- `observed_end <= _now()`;
- `end - start <= max_incident_span_seconds`;
- the configured maximum span is bounded and snapshotted.

The current pinned runtime exposes deterministic `gl.vm.get_timestamp()` in
deterministic execution. The contract has a defensive wall-clock fallback if the
VM timestamp call itself is unavailable; that fallback is not used by the pinned
runtime and was not treated as a reachable Studio behavior.

Future end, oversized span, reversed/zero-length interval, and invalid time
ordering were checked through source and current-SDK execution. Zero-length
incidents are explicitly rejected, so they cannot satisfy a positive minimum
duration. **Verdict: FIXED.**

## 13. F-08 through F-12

### F-08 — Challenge bond snapshot

`Incident.report_bond` and `Incident.challenge_bond` are written at opening and
`challenge_incident` uses the Incident snapshot, not mutable global configuration.
Independent local coverage confirmed changing the global challenge bond does not
change an existing Incident. Live Incident 2 shows bond 7 after the global value
was changed to 99. **FIXED.**

### F-09 — Scope normalization

`_normalize_scope` strips, lowercases, and bounds a syntax consisting of lowercase
letters, digits, `-`, `_`, and `.`. Pact scope is normalized on construction;
authoritative payload scope is normalized on fetch; resolution scope is derived
from authoritative support. Empty scope is rejected for Pact/evidence input and
`global` is the explicit global Pact token. **FIXED.**

### F-10 — Maintenance policy

Maintenance exclusions are disabled in V1. No Pact term, Resolution field,
prompt field, or payout branch accepts a model-selected maintenance exclusion.
The deployed `get_protocol_config` view reports `DISABLED_V1`; final Pact terms
contain no maintenance field. **FIXED — disabled in V1.**

### F-11 — Dead API

`cancel_pending_coverage` is absent from the source and deployed schema. There is
no fake pending Coverage lifecycle. **FIXED.**

### F-12 — Bounds, hashes, stats, views, retired services

- Availability and error-rate thresholds are capped at `1_000_000` ppm.
- p95 latency is capped at `86_400_000` milliseconds and block lag at
  `10_000_000` units; the units and constants are exposed in protocol config.
- Evidence hashes are mandatory normalized lowercase 64-hex SHA-256 values.
  `terms_hash` is required when a terms URI is supplied. Provider/service
  metadata hashes are optional metadata fields, but any supplied hash is
  format-validated; neither metadata field participates in settlement.
- `provider_fault_incidents` increments only for finalized
  `INCIDENT_CONFIRMED` resolutions whose fault domain is `PROVIDER`.
- `calculate_claim_payout` returns terminal status, stored payout, and
  `actionable=false` for terminal Claims; it does not create a new actionable
  payout.
- Draft/revision creation and publication reject retired Services.

**FIXED.**

## 14. New Findings Introduced by Hardening

No new Critical or High finding was introduced.

### NF-01 — Reporter independence is governance-enforced, not contract-enforced

Severity: **Low**

Location: `authorized_reporters` and `authorize_reporter`/
`revoke_reporter` (`contracts/FaultPact.py:1048-1061`).

The registry authenticates an address and snapshots its status, but it does not
store reporter type, operator ownership, probe identity, an independent source
attestation, or a prohibition on the Provider/protocol owner authorizing itself.
The live deployment's protocol owner and Provider owner are the same address, so
that address could authorize itself and manufacture structured authoritative
reports. This is not an unprivileged escalation: the same privileged owner can
already change treasury, bonds, reporter quorum, and other protocol controls.

Mitigation is deployment governance: use a distinct multisig/protocol owner and
independent reporter EOAs/operators, and do not authorize provider-controlled
reporters unless that is an explicit trust decision. The contract's intended
security boundary is “authorized reporters are trusted measurement sources”; it
does not claim cryptographic proof that a trusted reporter's measurement is true.

Other examined additions—fact-support storage, snapshotted deadlines, fallback
state transitions, challenge bond handling, and new views—did not produce a
reachable financial integrity defect.

## 15. Access Control Matrix

All rows below are final public writes. “Permissionless” means any caller meeting
the listed state/time/value guards; it is not an owner bypass.

| Method | Caller | Main guards / storage and economic effect |
|---|---|---|
| `pause_new_sales` | Owner or guardian | Sets global sales pause. |
| `resume_new_sales` | Owner | Clears global sales pause. |
| `set_protocol_fee` | Owner | Fee `<=1000` bps; future premium splits only. |
| `set_treasury` | Owner; accept by pending treasury | Nonzero two-step treasury change. |
| `accept_treasury` | Pending treasury | Completes two-step treasury change. |
| `set_guardian` | Owner; accept by pending guardian | Nonzero two-step guardian change. |
| `accept_guardian` | Pending guardian | Completes two-step guardian change. |
| `transfer_protocol_ownership` | Owner; accept by pending owner | Nonzero two-step ownership change. |
| `accept_protocol_ownership` | Pending owner | Completes two-step ownership change. |
| `set_withdrawal_cooldown` | Owner | Bounded cooldown; future capital withdrawals. |
| `set_bonds` | Owner | Mutable global report/challenge bonds; active Incident snapshots are unaffected. |
| `set_incident_windows` | Owner | Bounded future evidence/challenge windows; active Incidents are snapshotted. |
| `set_resolution_policy` | Owner | Bounded future quorum/timeout/span; active Incidents are snapshotted. |
| `authorize_reporter` | Owner | Nonzero address becomes authoritative for future submissions. |
| `revoke_reporter` | Owner | Nonzero address becomes supplemental for future submissions. |
| `register_provider` | Any caller | Creates provider/vault/stats; no value required. |
| `update_provider_metadata` | Provider owner | Bounded URI/hash; metadata only. |
| `transfer_provider_control` | Provider owner; accept by pending owner | Nonzero two-step Provider ownership. |
| `accept_provider_control` | Pending Provider owner | Completes Provider ownership transfer. |
| `create_service` | Provider owner | Provider exists; creates active Service. |
| `update_service_metadata` | Provider owner | Bounded URI/hash; metadata only. |
| `pause_service` | Provider owner | Active Service to paused. |
| `resume_service` | Provider owner | Paused Service to active. |
| `retire_service` | Provider owner | Service terminally retired. |
| `create_pact_draft` | Provider owner | Non-retired Service; bounded terms and nonempty normalized scope. |
| `update_pact_draft` | Provider owner | Draft-only bounded term update. |
| `publish_pact` | Provider owner | Sales unpaused, draft, Service not retired; freezes terms. |
| `create_pact_revision` | Provider owner | Published parent and non-retired Service; isolated frozen revision. |
| `pause_pact_sales` | Provider owner | Active Pact to paused. |
| `resume_pact_sales` | Provider owner | Paused Pact to active. |
| `retire_pact` | Provider owner | Pact terminally retired. |
| `deposit_capital` (payable) | Provider owner | Positive value increases total capital and deposit stats. |
| `allocate_capital` | Provider owner | Positive free capital; increases Pact/vault allocation. |
| `deallocate_capital` | Provider owner | Positive unreserved Pact allocation; decreases allocation. |
| `request_capital_withdrawal` | Provider owner | Positive free amount, one pending request; locks pending amount. |
| `cancel_capital_withdrawal` | Provider owner | Requires pending amount; clears pending request. |
| `execute_capital_withdrawal` | Provider owner | Cooldown/free-capital checks; decreases total capital and credits caller. |
| `buy_coverage` (payable) | Any caller | Sellable frozen Pact, slippage/payment/capacity checks; reserves full limit. |
| `expire_coverage` | Permissionless | Active Coverage after end; marks expired. |
| `release_earned_premium` | Permissionless | End/claim-deadline/open-claim checks; credits provider share and releases remaining reserve once. |
| `open_incident` (payable) | Any caller | Positive historical bounded interval and report bond; snapshots policy/bonds. |
| `attach_incident_report` | Any caller | Open evidence window, URI/hash; provenance determined by sender/type. |
| `acknowledge_incident` | Provider owner | Open Incident only; sets acknowledgement flag. |
| `submit_provider_statement` | Provider owner | Open evidence window, URI/hash; statement remains supplemental. |
| `seal_evidence_window` | Permissionless | After evidence deadline; seals Incident. |
| `submit_evidence` | Any caller | Open evidence window, valid type/URI/hash; separate provenance budgets. |
| `resolve_incident` | Permissionless | Evidence window closed/open-or-sealed; nondeterministic consensus and support validation. |
| `challenge_incident` (payable) | Any caller | Preliminary/window/one round/bond; optional challenge evidence and refund credit. |
| `submit_challenge_evidence` | Any caller | Challenged challenge-evidence window; challenge budget/provenance rules. |
| `resolve_challenge` | Permissionless | Challenge evidence closed and unresolved; same adjudication/support checks, bond outcome once. |
| `finalize_incident` | Permissionless | Preliminary after challenge deadline or challenge resolved; finalizes once and refunds report bond once. |
| `finalize_inconclusive_timeout` | Permissionless | Snapshotted resolution deadline; terminal inconclusive fallback, pending-claim close, bond handling. |
| `file_claim` | Coverage buyer | Coverage not released, claim deadline/overlap/service/duplicate checks; creates pending Claim and increments open claims. |
| `settle_claim` | Permissionless | Pending finalized Incident; deterministic Pact comparison, payout or ineligible transition once. |
| `withdraw_credit` | Top-level EOA (`sender == origin`) | Positive caller credit; debits before self-only external transfer. |

No new method grants a non-owner authority over reporter registry, protocol
configuration, provider vaults, or settlement facts.

## 16. Economic Invariants

| Invariant | Result | Evidence |
|---|---|---|
| `reserved <= allocated <= total` | PASS | `_assert_vault_invariants` is called after capital/reserve mutations; independent PoC and live vault view. |
| `allocated + pending withdrawal <= total` | PASS | Free-capital checks and invariant helper; live vault view. |
| Sum Pact allocations matches provider allocation | PASS | Allocation/deallocation/payout paths update both Pact and vault values. |
| Sum Pact reserves matches provider reserve | PASS | Reserve/release/debit helpers update both sides. |
| Full Coverage backing | PASS | Reserve equals Coverage limit and capacity requires `reserved + amount <= allocated`. |
| Payout <= remaining limit | PASS | `_payout_from_parts` and `settle_claim` cap and decrement remaining limit. |
| Payout <= remaining reserve backing | PASS | Payout is capped by `Coverage.reserved_amount`; provider reserved capital is debited. |
| No double settlement | PASS | Claim must be pending; terminal status blocks repeat. |
| No double premium release/reserve release | PASS | Per-Coverage flags; independent permanent test. |
| No reserve release with pending claims | PASS | `_coverage_releasable` requires `open_claims == 0`; timeout decrements claims once. |
| No double bond refund | PASS | Incident and Challenge refund flags; finalization/timeout state gates. |
| No double timeout finalization | PASS | Final Incident status rejects repeat. |
| No double credit withdrawal | PASS | Credit debit before transfer and insufficient-credit guard; local test and live zero-credit reads. |

The only economic limitation is F-06: a failed external transfer can consume the
withdrawing user's own already-debited credit because GenLayer does not expose the
needed recovery acknowledgement.

## 17. State Machines

```text
Service:   ACTIVE <-> PAUSED -> RETIRED
Pact:      DRAFT -> ACTIVE <-> PAUSED -> RETIRED
           ACTIVE/PAUSED/RETIRED parent -> isolated DRAFT revision
Coverage:  ACTIVE -> EXPIRED -> RELEASED
           ACTIVE -> RELEASED is allowed once end + claim deadline pass and no open claims
Incident:  OPEN -> EVIDENCE_SEALED -> PRELIMINARY -> FINALIZED
           PRELIMINARY -> CHALLENGED -> CHALLENGE_RESOLVED -> FINALIZED
           OPEN/SEALED with no valid resolution -> FINALIZED(INCONCLUSIVE) by timeout
Claim:     PENDING_RESOLUTION -> SETTLED or INELIGIBLE
Challenge: absent -> unresolved -> resolved, one round only
Reporter:  unauthorized/false -> authorized -> revoked/false
           submission provenance is immutable after each Evidence is stored
Withdrawal: no pending -> pending -> cancelled or executed-to-credit
            credit -> self-only external withdrawal
Maintenance: no V1 state machine; policy is DISABLED_V1
```

Illegal orderings are blocked by status and deadline guards. The timeout path is
available without owner/guardian cooperation when no valid resolution exists or
an active challenge never resolves.

## 18. GenLayer / Nondeterminism

- `resolve_incident` and `resolve_challenge` both use `gl.vm.run_nondet`.
- The leader and validator independently execute `_adjudicate`.
- The comparator exactly checks financially material fields and known metrics.
- Each execution independently fetches/reconciles evidence and validates support;
  support IDs are deliberately not required to be byte-identical across model
  executions because each side must satisfy the same deterministic support rules.
- Failed evidence is status-only before prompt construction.
- Valid supplemental text is labeled untrusted and cannot pass support validation.
- Challenge resolution uses the same evidence/support model as primary resolution.

The current official equivalence documentation describes independent validator
execution and exact comparison for objective results:

<https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle>

The current prompt-injection guidance emphasizes input restriction, output
restriction, and post-output validation:

<https://docs.genlayer.com/developers/intelligent-contracts/security-and-best-practices/prompt-injection>

The local direct harness intentionally runs the leader path and captures the
validator closure; it does not reproduce GenVM's independent validator process.
The deployed resolution transactions and finalized facts are observable, but
validator/model execution traces were not re-run during this read-only audit.

## 19. Test Assessment

### Repository suite

The permanent suite `tests/test_phase_0_1_hardening.py` was copied to a temporary
isolated directory and run against the current pinned SDK and copied hardened
contract:

```text
38 passed in 1.13s
0 failed
0 skipped
```

The suite exercises actual storage, decorators, calldata, contract methods, and
current-SDK VM boundaries. External web/LLM/transfer operations are controlled by
the harness, as expected for deterministic local tests. It is not a substitute
for live GenVM consensus.

### Independent PoCs

`/tmp/faultpact-phase-0-2/independent_pocs.py` passed independently authored
scenarios for:

- F-01 unauthorized evidence, unique-reporter quorum, and revocation snapshots;
- F-02 hash-mismatch prompt isolation and invalid support rejection;
- F-03 exact interval comparator and derived duration, including the original
  boundary disagreement shape;
- F-04 multibyte supplemental prompt denial of service;
- F-05 permissionless timeout and terminal claim/reserve release;
- economic reserve lock and release invariants.

Output: `independent PoCs: PASS`.

### Coverage gaps

The permanent suite does not independently test every case in the requested
matrix. In particular, it lacks dedicated named tests for multibyte prompt
inflation, complete web-response fetch limits, shared challenge-cap exhaustion,
wrong authoritative region/service live responses, unknown structured schema
keys, future structured evidence timestamps, and a full end-to-end local
two-Pact settlement. The live certification reported the two-Pact settlement;
this audit did not send replacement transactions. The missing tests do not hide
a discovered High issue, but they should be added before a production-network
release.

## 20. Toolchain

| Check | Result |
|---|---|
| `genvm-lint lint` | **PASS**, 3 checks |
| `genvm-lint validate` | **UNAVAILABLE / TOOLCHAIN INCOMPATIBILITY** |
| SDK used for local execution | pinned `v0.6.0-rc5` bundle |
| Executor bundle | `v0.2.17` |
| GenLayer JS live client | `0.40.0-rc.3` |
| GenLayer linter | `0.11.0` |
| Node | `v20.20.2` |

`genvm-lint validate` failed to load the SDK because it searched for:

```text
runners/py-genlayer/5j/ycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng.tar
```

The installed current SDK uses the `executor/v0.2.17/legacy-runners` layout.
This is not a validation pass. It prevents that particular artifact-layout
validation command from providing additional assurance, but source lint,
current-SDK contract execution, deployed source/schema comparison, read-only
views, and live transaction artifacts were available.

## 21. Live Read-Only Verification

The following actions were independently performed without state changes:

- chain ID read: `61997`;
- deployed source fetch and SHA/byte comparison;
- deployed schema extraction and local schema comparison;
- receipt reads for deployment, resolution, challenge, settlements, fallback,
  and withdrawals; all listed receipts were found with status `0x1`;
- both reporter authorization views;
- Evidence 1–4 and 7 views;
- Incident 1/2/3, Resolution 1/3, Claim 1/3, Coverage 1/3, and Challenge 2
  views;
- all 23 final readonly views against populated deployed state.

The independent 23-view run used the discovered deployed schema and returned
PASS for every view:

| View | Args | Independent result |
|---|---|---|
| `quote_coverage` | `[2,50,60]` | PASS; sellable, reserve 50, normalized scope |
| `can_finalize_incident` | `[1]` | PASS; false after finalization |
| `calculate_claim_payout` | `[1]` | PASS; stored settled payout, terminal/actionable false |
| `preview_claim_payout` | `[1,1]` | PASS; exhausted reserve not actionable |
| `can_settle_claim` | `[1]` | PASS; false for terminal Claim |
| `get_protocol_config` | `[]` | PASS; quorum 2, timeout 60, span 3600, maintenance disabled |
| `is_authorized_reporter` | `[reporter1]` | PASS; true |
| `get_counters` | `[]` | PASS; populated counters |
| `get_provider` | `[1]` | PASS |
| `get_provider_vault` | `[1]` | PASS; solvency inequalities hold |
| `get_provider_stats` | `[1]` | PASS; incident/fault/payout statistics coherent |
| `get_service` | `[1]` | PASS |
| `get_pact` | `[1]` | PASS; Pact A p95 threshold 150 |
| `get_pact_terms` | `[1]` | PASS; normalized scope/no maintenance |
| `get_pact_capacity` | `[1]` | PASS; available equals allocated minus reserved |
| `get_coverage` | `[1]` | PASS; released and exhausted after settlement |
| `get_incident` | `[1]` | PASS; finalized snapshots present |
| `get_incident_resolution` | `[1]` | PASS; exact facts/support/unusable IDs |
| `get_evidence` | `[7]` | PASS; supplemental and unauthorized-at-submission |
| `get_incident_evidence_ids` | `[1]` | PASS; `[1,2,3,4]` |
| `get_challenge` | `[2]` | PASS; bond 7, resolved/refunded |
| `get_claim` | `[1]` | PASS; settled payout 1000 |
| `get_claimable_balance` | `[buyer]` | PASS; zero after withdrawal |

## 22. Hardening Certification Claim Review

| Phase 0.1 claim | Independent classification | Basis |
|---|---|---|
| Local hardened SHA | INDEPENDENTLY VERIFIED | Local hash exact. |
| New deployment/address/chain | INDEPENDENTLY VERIFIED | Chain ID, source, schema, and receipt read. |
| 78/23/55/4 method counts | INDEPENDENTLY VERIFIED | Local AST versus deployed schema exact. |
| `genvm-lint lint` | INDEPENDENTLY VERIFIED | Re-run on fetched deployed source. |
| 38/0/0 automated tests | INDEPENDENTLY VERIFIED | Re-run in isolated copy; no source/test edits. |
| `genvm-lint validate` limitation | INDEPENDENTLY VERIFIED | Same missing legacy artifact path reproduced. |
| Live two-reporter provenance | INDEPENDENTLY VERIFIED | Read both authorization views and Evidence 1/2 provenance/submitters. |
| Live invalid evidence exclusion | SUPPORTED BY ARTIFACTS BUT NOT RE-RUN | Resolution view shows `[3,4]` unusable and support only `[1,2]`; prompt trace not onchain. |
| Real GenLayer resolution | SUPPORTED BY ARTIFACTS BUT NOT RE-RUN | Successful receipt and finalized Resolution state; no state-changing duplicate was sent. |
| Exact live interval/duration | INDEPENDENTLY VERIFIED for stored state | Resolution view shows exact endpoints and `duration=10`; disagreement was local-only. |
| Live differential Pact settlement | SUPPORTED BY ARTIFACTS BUT NOT RE-RUN | Existing deployed claim/Pact state and certification receipts; no replacement settlement. |
| Live timeout fallback | INDEPENDENTLY VERIFIED for current state | Incident 3/Claim 3/Coverage 3 views show terminal inconclusive path. |
| Live challenge-bond snapshot | INDEPENDENTLY VERIFIED for current state | Incident 2 Challenge view shows bond 7; receipt exists. |
| Live native withdrawals | SUPPORTED BY ARTIFACTS BUT NOT RE-RUN | Receipts and zero-credit read; no new withdrawal/failure experiment. |
| 23/23 live views | INDEPENDENTLY VERIFIED | Schema-discovered read-only script called all 23. |

## 23. Frontend / Backend Integration Warnings

These are contract behavior requirements for a future Phase 1 integration; they
do not transfer security responsibility to application code.

- Network is Studio Dev chain `61997`; candidate address is
  `0xeb858957e3C426597245f6b59E260f1cC556Bf13`. The old `0xE3A4...` address is
  historical only.
- Only owner can authorize/revoke reporters. Evidence provenance is fixed at
  submission. A reporter revoked later does not downgrade old evidence.
- `AUTHORITATIVE` means authorized address plus allowed structured evidence type
  and valid `faultpact-probe-v1` bytes. `SUPPLEMENTAL` is context only and can
  never support payout-bearing facts.
- Every payout-bearing Resolution fact must use valid Evidence IDs. Consumers
  must inspect `fact_support`, `usable_evidence_ids`, `unusable_evidence_ids`,
  `evidence_sufficiency`, and finalization state.
- Incident evidence, challenge, and resolution deadlines are snapshotted. The
  permissionless timeout fallback may produce terminal `INCONCLUSIVE` and no
  payout when resolution does not complete.
- A preliminary Resolution is not yet final. Claims may be pending until the
  challenge window and finalization; challenge evidence follows the same trust
  rules.
- Claim filing is buyer-only, duplicate Coverage+Incident filing is rejected,
  and the Coverage claim deadline is `coverage end + claim window`.
- Pact comparison is deterministic and happens after one canonical finalized
  Incident facts record. AI does not decide per-Pact thresholds or payout.
- Maintenance exclusions are not supported in V1. There is no maintenance field
  to display or enforce.
- `withdraw_credit` is self-only and sender/origin restricted. It debits before
  the external finalized EOA transfer; integrations must surface F-06's lack of
  failure recovery and use operational EOAs for credit recipients.
- `calculate_claim_payout` is a terminal-result view for terminal claims and
  reports `actionable=false`; `preview_claim_payout` and `quote_coverage` are
  previews, not settlement receipts.
- There is no `cancel_pending_coverage` API. Capital withdrawal cancellation is
  a separate Provider capital operation.

## 24. Remaining Risks / Accepted Limitations

1. **F-04 Medium:** arbitrary supplemental URLs can still impose full fetch work;
   selected multibyte content can delay normal resolution until timeout; shared
   challenge evidence capacity can be Sybil-filled. Timeout is the liveness
   mitigation, not a complete resource defense.
2. **F-06 Medium:** external transfer failure can consume the withdrawing user's
   own credit; GenLayer runtime has no usable recovery acknowledgement.
3. **NF-01 Low:** authoritative reporter independence and measurement truth are
   governance assumptions. Use an owner distinct from the Provider and maintain
   independent reporter identities.
4. `genvm-lint validate` remains unavailable for the pinned SDK artifact layout.
   This is a toolchain limitation, not a contract pass claim.
5. Permissionless provider registration is storage-growth capable. It does not
   bypass settlement or solvency, but production operations may want economic
   admission controls in a later version.

No remaining item found in this review permits unprivileged false payout, unbacked
liability, double settlement, double reserve release, quorum bypass, approximate
financial boundary acceptance, or permanent attacker-induced reserve lock.

## 25. Final Verdict

**FAULTPACT V1 RE-AUDIT PASS WITH ACCEPTED LIMITATIONS — READY FOR CONTRACT FREEZE**

This is an independent re-audit conclusion, not an independent audit of the
underlying GenLayer protocol or a claim that F-04/F-06 have no limitations.
