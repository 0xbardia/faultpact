# Frontend Deployment

## Intended topology

```text
faultpact.bydx.fun/          -> apps/web
faultpact.bydx.fun/api/      -> Phase 1/2 API
faultpact.bydx.fun/evidence/ -> immutable evidence endpoint
```

The web build runs with the standard Next production server. The API and
evidence routes remain owned by the existing backend. A reverse proxy must not
cache personalized responses or rewrite evidence bytes.

## Configuration

Set:

```text
NEXT_PUBLIC_API_BASE_URL=/api/v1
NEXT_PUBLIC_SITE_URL=https://faultpact.bydx.fun
NEXT_PUBLIC_CHAIN_ID=61997
NEXT_PUBLIC_CONTRACT_ADDRESS=0xeb858957e3C426597245f6b59E260f1cC556Bf13
BACKEND_API_URL=http://api:4310
```

The browser receives no reporter key, admin token, or RPC credential. Build
startup and API readiness must continue to verify chain 61997 and the frozen
contract address.

## Pre-deploy checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Then verify `/`, `/api/v1/ready`, `/evidence/<sha256>.json`, `/docs`, and mobile
navigation through the configured TLS endpoint. Run `nginx -t` before any proxy
reload; this phase does not change unrelated host configuration.

## Current execution status

This workspace has a local runtime smoke path on port 3001. Production DNS/TLS
deployment is not claimed until the domain is independently reachable.
