# FaultPact application architecture

FaultPact uses the frozen Intelligent Contract as the financial authority. The
application is an indexed/read and monitoring system around that contract; it
does not reimplement claim eligibility, breach decisions, payout arithmetic, or
collateral accounting.

```text
Studio Dev 61997 / frozen contract
        | read-only adapter, source/schema verification
        v
     indexer -------> PostgreSQL <------- Fastify read API
        |                                  |
        |                                  +-- cached/indexed state with freshness
        v
   probe worker -> samples -> aggregates -> incident candidates
                                      |
                                      v
                         canonical probe artifact -> SHA-256 -> immutable bytes
                                      |
                         optional operator/reporter submission path
```

The database is an operational index. If it disagrees with an onchain view,
the contract wins and reconciliation updates the database. Raw onchain JSON is
kept beside normalized fields to support future schema changes and audits.

The adapter discovers and verifies the final deployed schema: 78 methods, 23
views, 55 writes, and 4 payable methods. Ordinary user writes are deliberately
not signed by the backend. A separately configured reporter key is optional and
isolated to the worker.

The current Studio RPC deployment uses the legacy `gen_call` calldata shape.
The adapter contains the small protocol codec needed to read this frozen
deployment. `genlayer-js` remains pinned for account/transaction compatibility,
but its current Studio encoding was not used for these reads because it does
not match the deployed legacy shape.
