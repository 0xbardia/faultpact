# Frontend Integration

## Frozen deployment

| Field | Value |
| --- | --- |
| Network | GenLayer Studio Development Preview |
| Chain | `61997` |
| Contract | `0xeb858957e3C426597245f6b59E260f1cC556Bf13` |
| Source SHA-256 | `4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e` |

The canonical deployment manifest is `deployments/studio-dev.json`. Runtime
code must not use the historical pre-hardening address.

## Data ownership

The API is the discovery/indexing layer. Contract reads are the authority for
final financial state. A future action adapter must refresh onchain state after
GenLayer processing and must not mark a transaction final at submission time.

## Wallet actions

The frontend is prepared with an EIP-1193 connect/chain-check boundary. The
current frozen deployment has no independently verified browser calldata
transport in `packages/contract`, so purchase, claim, provider-capital, and
withdrawal surfaces stop at a review state. This is deliberate: an unverified
write is worse than a visible unavailable action.

When the transport is verified, the action review must preserve:

1. input validation and current-state read;
2. explicit review of amount, deadlines, scope, and capacity;
3. wallet chain check for 61997;
4. submission/processing/decision/finalization tracking;
5. refresh from contract state after finalization.

## Truth labels

`Indexed` means database state refreshed from the contract. `Monitoring` means
offchain telemetry. `Candidate` means an operational signal. `Finalized` and
`Settled` only describe terminal contract state returned by the API/indexer.

## Evidence

Evidence pages expose reporter, hash, fetch/hash/schema status, and whether a
record was excluded from a finalized resolution. Raw content must remain escaped
JSON/text; never render arbitrary evidence as HTML.

