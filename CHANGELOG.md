# Changelog

## v1.0.0 — unreleased candidate

This entry describes the current FaultPact release candidate. The `v1.0.0` tag and GitHub Release have not been created because final release gates remain open.

- Public Provider, Service, Pact, Coverage, Incident, Claim, monitoring, and documentation pages.
- Browser wallet flow for reviewing and purchasing Coverage against the frozen Pact contract.
- Provider capital vault records and Pact capacity indexing.
- Canonical Incident facts, evidence provenance, challenges, and deterministic contract evaluation.
- Regional RPC probes, aggregation, and immutable SHA-256 evidence artifacts.
- Bounded read API, indexer reconciliation, operations status, and PostgreSQL persistence.
- Signer-backed evidence worker: an authorized reporter wallet can submit one canonical immutable artifact through `attach_incident_report` and `submit_evidence`, wait for GenLayer finalization, and verify the resulting evidence from contract state. Retry-safe, fail-closed, and gated on a read-only authorization preflight.
- Address-typed contract reads (`is_authorized_reporter`, `get_claimable_balance`) now encode correctly against the Studio node.
- Final pass corrections for Pact terms, exact GEN display, indexed freshness, RPC cooldowns, SEO metadata, and public error handling.

Known release blockers: Provider registration and capital write flows and customer claim filing are not exposed in the web console; the live browser wallet confirmation path and live Studio schema validation remain unverified.
