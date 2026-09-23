# FaultPact Frontend

The frontend lives in `apps/web` and is a Next.js App Router application. It is
read-first by design: public discovery comes from the Phase 1/2 API, while
financial truth remains the frozen FaultPact deployment on GenLayer Studio Dev.

## Runtime boundaries

- `lib/api.ts` and `lib/use-api.ts` call the indexed API through `/api/v1`.
- `lib/format.ts` keeps onchain integer values as strings/`bigint`-compatible
  values; it never converts financial values to JavaScript `number`.
- `lib/wallet.ts` only discovers an EIP-1193 browser wallet, checks Chain 61997,
  and supports connect/switch UX.
- `components/actions.tsx` is a review gate. It does not send a user
  transaction until the legacy GenLayer browser calldata transport is verified
  against the frozen deployment.

The server never receives a user private key. Public pages work disconnected.

## Development

```bash
pnpm install
pnpm --filter @faultpact/web dev
pnpm test:e2e
```

The web app expects `NEXT_PUBLIC_API_BASE_URL=/api/v1`. In local development,
Next rewrites that path to the API configured by `BACKEND_API_URL`.

## Routes

The public surface includes the landing page, explorer lists and entity detail
pages for Providers, Services, Pacts, Coverages, Incidents, and Claims. The
product surface includes `/app`, `/app/purchase`, `/provider`,
`/provider/capital`, `/provider/pacts`, `/monitoring`, `/status`, and the
first-class `/docs` tree.

## Product rules

- Indexed state is labeled with freshness and is not presented as an onchain
  receipt.
- Monitoring is a signal. It is never rendered as final claim eligibility.
- Incident facts are shown separately from Pact-specific deterministic
  evaluation.
- Authoritative evidence is shown separately from supplemental or excluded
  evidence; SHA-256 is described as byte integrity, not truth.
- Claimable FaultPact credit is not labeled as a wallet balance.
- External GEN transfer completion is not claimed until the contract/runtime
  provides verified finality.
