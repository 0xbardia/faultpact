import { describe, expect, it } from "vitest";
import { FaultPactIndexer } from "./indexer.js";

function fakeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    address: "0xeb858957e3C426597245f6b59E260f1cC556Bf13",
    chainId: 61997,
    schema: { methods: {} },
    verifyDeployment: async () => ({ chainId: 61997, sourceSha256: "a".repeat(64), sourceByteLength: 1, sourceMatches: true, schemaFingerprint: "b".repeat(64), schemaMatchesSnapshot: true, address: "0xeb858957e3C426597245f6b59E260f1cC556Bf13" }),
    getCounters: async () => ({ next_provider_id: "2", next_service_id: "1", next_pact_id: "1", next_coverage_id: "1", next_incident_id: "1", next_evidence_id: "1", next_claim_id: "1" }),
    getProtocolConfig: async () => ({ min_authoritative_reporters: "2" }),
    getEntity: async (kind: string) => kind === "provider" ? { id: "1", owner: "0x0000000000000000000000000000000000000001", name: "provider", status: "ACTIVE" } : {},
    read: async () => ({}),
    ...overrides,
  } as never;
}

function fakeDb() {
  const providerRows = new Map<string, unknown>();
  const serviceRows = new Map<string, { id: number }>();
  const pactRows = new Map<string, { create: Record<string, unknown>; update: Record<string, unknown> }>();
  const cursors = new Map<string, Record<string, unknown>>();
  const evidenceRows: Record<string, unknown>[] = [];
  const claims = [{ id: 1, onchainId: { toString: () => "1" }, status: "PENDING" }];
  const db = {
    deployment: { upsert: async () => ({ id: 1 }) },
    protocolSnapshot: { upsert: async () => undefined },
    contractSnapshot: { create: async () => undefined },
    syncCursor: { upsert: async (args: { where: { deploymentId_entityKind: { entityKind: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => { const kind = args.where.deploymentId_entityKind.entityKind; cursors.set(kind, { ...cursors.get(kind), ...(cursors.has(kind) ? args.update : args.create) }); } },
    provider: { upsert: async (args: { where: { deploymentId_onchainId: { onchainId: { toString(): string } } } }) => { providerRows.set(args.where.deploymentId_onchainId.onchainId.toString(), args); }, findUnique: async (args: { where: { deploymentId_onchainId: { onchainId: { toString(): string } } } }) => providerRows.has(args.where.deploymentId_onchainId.onchainId.toString()) ? { id: 1 } : null },
    service: { upsert: async (args: { where: { deploymentId_onchainId: { onchainId: { toString(): string } } } }) => { serviceRows.set(args.where.deploymentId_onchainId.onchainId.toString(), { id: 1 }); }, findUnique: async (args: { where: { deploymentId_onchainId: { onchainId: { toString(): string } } } }) => serviceRows.get(args.where.deploymentId_onchainId.onchainId.toString()) ?? null },
    pact: { upsert: async (args: { where: { deploymentId_onchainId: { onchainId: { toString(): string } } }; create: Record<string, unknown>; update: Record<string, unknown> }) => { pactRows.set(args.where.deploymentId_onchainId.onchainId.toString(), args); return { id: 1 }; }, findUnique: async () => null },
    pactTerms: { upsert: async () => undefined },
    pactCapacity: { upsert: async () => undefined },
    coverage: { upsert: async () => undefined, findUnique: async () => null },
    incident: { upsert: async () => ({ id: 1 }), findUnique: async () => ({ id: 1 }) },
    incidentResolution: { upsert: async () => undefined },
    evidence: { upsert: async (args: { create: Record<string, unknown> }) => { evidenceRows.push(args.create); } },
    claim: { upsert: async () => undefined, findMany: async () => claims, update: async (args: { data: { status: string } }) => { claims[0]!.status = args.data.status; } },
    reconciliationRecord: { create: async () => undefined },
  };
  return { db: db as never, providerRows, claims, cursors, pactRows, evidenceRows };
}

describe("idempotent onchain indexer", () => {
  it("INDEXER_BOOTSTRAP", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter(), { maxEntityId: 2n, rpcMinIntervalMs: 0 });
    const result = await indexer.syncOnce();
    expect(result.indexed.provider).toBe(1);
    expect(fake.providerRows.size).toBe(1);
  });
  it("INDEXER_IDEMPOTENCY", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter(), { maxEntityId: 2n, rpcMinIntervalMs: 0 });
    await indexer.syncOnce();
    await indexer.syncOnce();
    expect(fake.providerRows.size).toBe(1);
  });
  it("INDEXER_RESTART", async () => {
    const fake = fakeDb();
    await new FaultPactIndexer(fake.db, fakeAdapter(), { maxEntityId: 2n, rpcMinIntervalMs: 0 }).syncOnce();
    await new FaultPactIndexer(fake.db, fakeAdapter(), { maxEntityId: 2n, rpcMinIntervalMs: 0 }).syncOnce();
    expect(fake.providerRows.size).toBe(1);
  });
  it("INDEXER_RPC_FAILURE_NO_DATA_DELETION", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async () => { throw new Error("temporary RPC failure"); } }), { maxEntityId: 2n, rpcMinIntervalMs: 0 });
    await indexer.syncOnce();
    expect(fake.providerRows.size).toBe(0);
  });
  it("INDEXER_PARTIAL_FAILURE_DEGRADES_OVERALL_CURSOR", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async (kind: string) => { if (kind === "provider") throw new Error("temporary RPC failure"); return {}; } }), { maxEntityId: 2n, rpcMinIntervalMs: 0 });
    await indexer.syncOnce();
    expect(fake.cursors.get("provider")?.status).toBe("DEGRADED");
    expect(fake.cursors.get("all")?.status).toBe("DEGRADED");
  });
  it("INDEXER_STOPS_ENTITY_SCAN_DURING_RPC_COOLDOWN", async () => {
    const fake = fakeDb();
    let calls = 0;
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({
      getCounters: async () => ({ next_provider_id: "5" }),
      getEntity: async () => { calls += 1; throw new Error("GenLayer RPC HTTP 429 cooldown"); },
    }), { maxEntityId: 10n, rpcMinIntervalMs: 0 });
    await indexer.syncOnce();
    expect(calls).toBe(1);
    expect(String(fake.cursors.get("provider")?.nextId)).toBe("1");
    expect(fake.cursors.get("all")?.status).toBe("DEGRADED");
  });
  it("INDEXER_READS_REGION_SCOPE_FROM_PACT_TERMS", async () => {
    const fake = fakeDb();
    const contract = fakeAdapter({
      getCounters: async () => ({ next_provider_id: "2", next_service_id: "2", next_pact_id: "2" }),
      getEntity: async (kind: string) => kind === "provider"
        ? { id: "1", owner: "0x0000000000000000000000000000000000000001" }
        : kind === "service" ? { id: "1", provider_id: "1", name: "service" }
          : kind === "pact" ? { id: "1", service_id: "1", provider_id: "1", terms: { region_scope: "us-east" } }
            : {},
    });
    await new FaultPactIndexer(fake.db, contract, { maxEntityId: 2n, rpcMinIntervalMs: 0 }).syncOnce();
    expect(fake.pactRows.get("1")?.create.regionScope).toBe("us-east");
  });
  it("INDEXER_DOES_NOT_CLAIM_EXTERNAL_EVIDENCE_WAS_VERIFIED", async () => {
    const fake = fakeDb();
    const contract = fakeAdapter({
      getCounters: async () => ({ next_provider_id: "2", next_service_id: "2", next_incident_id: "2", next_evidence_id: "2" }),
      getEntity: async (kind: string) => kind === "provider"
        ? { id: "1", owner: "0x0000000000000000000000000000000000000001" }
        : kind === "service" ? { id: "1", provider_id: "1" }
          : kind === "incident" ? { id: "1", service_id: "1" }
            : kind === "evidence" ? { id: "1", incident_id: "1", uri: "https://example.com/evidence", content_hash: "a".repeat(64), provenance: "AUTHORITATIVE", reporter_authorized_at_submission: true }
              : {},
    });
    await new FaultPactIndexer(fake.db, contract, { maxEntityId: 2n, rpcMinIntervalMs: 0 }).syncOnce();
    expect(fake.evidenceRows[0]).toMatchObject({ fetchStatus: "NOT_CHECKED", hashStatus: "NOT_CHECKED", schemaStatus: "NOT_CHECKED", usable: null, artifactSha256: null });
  });
  it("INDEXER_STOPS_CLAIM_RECONCILIATION_DURING_RPC_COOLDOWN", async () => {
    const fake = fakeDb();
    fake.claims.push({ id: 2, onchainId: { toString: () => "2" }, status: "PENDING" }, { id: 3, onchainId: { toString: () => "3" }, status: "PENDING" });
    let calls = 0;
    const contract = fakeAdapter({ getEntity: async () => { calls += 1; throw new Error("GenLayer RPC HTTP 429 cooldown"); } });
    await new FaultPactIndexer(fake.db, contract, { maxEntityId: 2n, rpcMinIntervalMs: 0 }).reconcile();
    expect(calls).toBe(1);
    expect(fake.claims.every((claim) => claim.status === "PENDING")).toBe(true);
  });
  it("INDEXER_RECONCILIATION_CONTRACT_WINS", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async (kind: string) => kind === "claim" ? { id: "1", status: "SETTLED" } : {} }), { deploymentId: 1, rpcMinIntervalMs: 0 });
    const anomalies = await indexer.reconcile();
    expect(anomalies).toBe(1);
    expect(fake.claims[0]?.status).toBe("SETTLED");
  });
});
