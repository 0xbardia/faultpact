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
  const claims = [{ id: 1, onchainId: { toString: () => "1" }, status: "PENDING" }];
  const db = {
    deployment: { upsert: async () => ({ id: 1 }) },
    protocolSnapshot: { upsert: async () => undefined },
    contractSnapshot: { create: async () => undefined },
    syncCursor: { upsert: async () => undefined },
    provider: { upsert: async (args: { where: { deploymentId_onchainId: { onchainId: { toString(): string } } } }) => { providerRows.set(args.where.deploymentId_onchainId.onchainId.toString(), args); }, findUnique: async () => null },
    service: { upsert: async () => undefined, findUnique: async () => null },
    pact: { upsert: async () => ({ id: 1 }), findUnique: async () => null },
    pactTerms: { upsert: async () => undefined },
    pactCapacity: { upsert: async () => undefined },
    coverage: { upsert: async () => undefined, findUnique: async () => null },
    incident: { upsert: async () => ({ id: 1 }), findUnique: async () => null },
    incidentResolution: { upsert: async () => undefined },
    evidence: { upsert: async () => undefined },
    claim: { upsert: async () => undefined, findMany: async () => claims, update: async (args: { data: { status: string } }) => { claims[0]!.status = args.data.status; } },
    reconciliationRecord: { create: async () => undefined },
  };
  return { db: db as never, providerRows, claims };
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
  it("INDEXER_RECONCILIATION_CONTRACT_WINS", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async (kind: string) => kind === "claim" ? { id: "1", status: "SETTLED" } : {} }), { deploymentId: 1, rpcMinIntervalMs: 0 });
    const anomalies = await indexer.reconcile();
    expect(anomalies).toBe(1);
    expect(fake.claims[0]?.status).toBe("SETTLED");
  });
});
