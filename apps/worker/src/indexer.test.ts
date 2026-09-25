import { describe, expect, it, vi } from "vitest";
import { FaultPactIndexer } from "./indexer.js";

const emptyCounters = {
  next_provider_id: "2",
  next_service_id: "1",
  next_pact_id: "1",
  next_coverage_id: "1",
  next_incident_id: "1",
  next_evidence_id: "1",
  next_claim_id: "1",
};

function projectionRead(method: string): Record<string, unknown> {
  if (method === "get_provider_vault") return { total_capital: "10", allocated: "1", reserved: "2", pending: "0" };
  if (method === "get_provider_stats") return { total_pacts: "1", total_coverages: "1", finalized_incidents: "0", provider_fault_incidents: "0" };
  if (method === "get_pact_terms") return { region_scope: "us-east", terms_uri: "https://example.com/terms" };
  if (method === "get_pact_capacity") return { allocated: "5", reserved: "1", available: "4" };
  if (method === "get_incident_resolution") return { finalized: false, fact_support: {} };
  if (method === "get_challenge") return {};
  return {};
}

function fakeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    address: "0xeb858957e3C426597245f6b59E260f1cC556Bf13",
    chainId: 61997,
    schema: { methods: { get_provider_vault: {}, get_provider_stats: {}, get_pact_terms: {}, get_pact_capacity: {}, get_incident_resolution: {}, get_challenge: {} } },
    verifyDeployment: async () => ({ chainId: 61997, sourceSha256: "a".repeat(64), sourceByteLength: 1, sourceMatches: true, schemaFingerprint: "b".repeat(64), schemaMatchesSnapshot: true, address: "0xeb858957e3C426597245f6b59E260f1cC556Bf13" }),
    getCounters: async () => emptyCounters,
    getProtocolConfig: async () => ({ min_authoritative_reporters: "2" }),
    getEntity: async (kind: string) => kind === "provider" ? { id: "1", owner: "0x0000000000000000000000000000000000000001", name: "provider", status: "ACTIVE" } : {},
    read: async (method: string) => projectionRead(method),
    ...overrides,
  } as never;
}

type Row = Record<string, any>;

function fakeDb() {
  const providerRows = new Map<string, Row>();
  const serviceRows = new Map<string, Row>();
  const pactRows = new Map<string, Row>();
  const coverageRows = new Map<string, Row>();
  const incidentRows = new Map<string, Row>();
  const evidenceRows = new Map<string, Row>();
  const claimRows = new Map<string, Row>();
  const providerVaultRows = new Map<number, Row>();
  const providerStatsRows = new Map<number, Row>();
  const pactTermsRows = new Map<number, Row>();
  const pactCapacityRows = new Map<number, Row>();
  const resolutionRows = new Map<number, Row>();
  const challengeRows = new Map<number, Row>();
  const cursors = new Map<string, Row>();
  const reconciliationRecords: Row[] = [];
  let nextId = 1;

  const allCounters = (ids: Record<string, number>) => ({
    next_provider_id: String((ids.provider ?? 0) + 1),
    next_service_id: String((ids.service ?? 0) + 1),
    next_pact_id: String((ids.pact ?? 0) + 1),
    next_coverage_id: String((ids.coverage ?? 0) + 1),
    next_incident_id: String((ids.incident ?? 0) + 1),
    next_evidence_id: String((ids.evidence ?? 0) + 1),
    next_claim_id: String((ids.claim ?? 0) + 1),
  });

  const matches = (row: Row, where: Row = {}): boolean => {
    if (where.deploymentId !== undefined && row.deploymentId !== undefined && Number(row.deploymentId) !== Number(where.deploymentId)) return false;
    const status = where.status;
    if (status === null && row.status !== null) return false;
    if (typeof status === "string" && row.status !== status) return false;
    if (status && typeof status === "object") {
      const equals = status.equals;
      const not = status.not;
      if (equals !== undefined && row.status !== equals) return false;
      if (not !== undefined && row.status === not) return false;
    }
    for (const clause of where.OR ?? []) if (matches(row, clause)) return true;
    if (where.OR) return false;
    return true;
  };

  const selectRows = (rows: Map<string, Row>, where: Row = {}, orderBy: { indexedAt?: "asc" | "desc" } = {}) => [...rows.values()]
    .filter((row) => matches(row, where))
    .sort((left, right) => {
      const leftTime = left.indexedAt instanceof Date ? left.indexedAt.getTime() : 0;
      const rightTime = right.indexedAt instanceof Date ? right.indexedAt.getTime() : 0;
      return orderBy.indexedAt === "desc" ? rightTime - leftTime : leftTime - rightTime;
    })
    .map((row) => ({ ...row }));

  const upsertRows = <K>(rows: Map<K, Row>, args: Row): Row => {
    const unique = args.where?.deploymentId_onchainId;
    const key = unique ? unique.onchainId.toString() : Object.values(args.where ?? {})[0]?.toString() ?? String(nextId);
    const existing = rows.get(key);
    const row = existing
      ? { ...existing, ...(args.update ?? {}), id: existing.id, indexedAt: (args.update ?? {}).indexedAt ?? new Date() }
      : { id: nextId++, ...(args.create ?? {}), indexedAt: (args.create ?? {}).indexedAt ?? new Date() };
    rows.set(key, row);
    return { ...row };
  };

  const findUnique = (rows: Map<string, Row>, args: Row): Row | null => {
    const unique = args.where?.deploymentId_onchainId;
    if (unique) {
      const row = rows.get(unique.onchainId.toString());
      return row ? { ...row } : null;
    }
    const value = Object.values(args.where ?? {})[0]?.toString();
    return value ? rows.get(value) ? { ...rows.get(value)! } : null : null;
  };

  const db: Row = {
    deployment: { findFirst: async () => ({ id: 1, sourceSha256: "4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e", verifiedAt: new Date() }), upsert: async () => ({ id: 1 }) },
    protocolSnapshot: { upsert: async () => undefined },
    contractSnapshot: { create: async () => undefined },
    syncCursor: {
      findUnique: async (args: Row) => cursors.get(args.where.deploymentId_entityKind.entityKind) ? { ...cursors.get(args.where.deploymentId_entityKind.entityKind)! } : null,
      upsert: async (args: Row) => {
        const kind = args.where.deploymentId_entityKind.entityKind;
        cursors.set(kind, { ...(cursors.get(kind) ?? {}), ...(cursors.has(kind) ? args.update : args.create) });
        return { ...cursors.get(kind)! };
      },
    },
    provider: { findMany: async (args: Row) => selectRows(providerRows, args.where, args.orderBy), findUnique: async (args: Row) => findUnique(providerRows, args), upsert: async (args: Row) => upsertRows(providerRows, args) },
    providerVault: { upsert: async (args: Row) => upsertRows(providerVaultRows, args) },
    providerStats: { upsert: async (args: Row) => upsertRows(providerStatsRows, args) },
    service: { findMany: async (args: Row) => selectRows(serviceRows, args.where, args.orderBy), findUnique: async (args: Row) => findUnique(serviceRows, args), upsert: async (args: Row) => upsertRows(serviceRows, args) },
    pact: { findMany: async (args: Row) => selectRows(pactRows, args.where, args.orderBy), findUnique: async (args: Row) => findUnique(pactRows, args), upsert: async (args: Row) => upsertRows(pactRows, args) },
    pactTerms: { upsert: async (args: Row) => upsertRows(pactTermsRows, args) },
    pactCapacity: { upsert: async (args: Row) => upsertRows(pactCapacityRows, args) },
    coverage: { findMany: async (args: Row) => selectRows(coverageRows, args.where, args.orderBy), findUnique: async (args: Row) => findUnique(coverageRows, args), upsert: async (args: Row) => upsertRows(coverageRows, args) },
    incident: { findMany: async (args: Row) => selectRows(incidentRows, args.where, args.orderBy), findUnique: async (args: Row) => findUnique(incidentRows, args), upsert: async (args: Row) => upsertRows(incidentRows, args) },
    incidentResolution: { upsert: async (args: Row) => upsertRows(resolutionRows, args) },
    challenge: { upsert: async (args: Row) => upsertRows(challengeRows, args) },
    evidence: { findMany: async (args: Row) => selectRows(evidenceRows, args.where, args.orderBy), findUnique: async (args: Row) => findUnique(evidenceRows, args), upsert: async (args: Row) => upsertRows(evidenceRows, args) },
    claim: { findMany: async (args: Row) => selectRows(claimRows, args.where, args.orderBy), findUnique: async (args: Row) => findUnique(claimRows, args), upsert: async (args: Row) => upsertRows(claimRows, args) },
    reconciliationRecord: {
      create: async (args: Row) => { const row = { id: reconciliationRecords.length + 1, createdAt: new Date(), ...args.data }; reconciliationRecords.push(row); return { ...row }; },
      findMany: async () => reconciliationRecords.map((row) => ({ ...row })),
    },
  };
  db.$transaction = async (callback: (tx: Row) => Promise<unknown>) => callback(db);
  return { db: db as never, providerRows, serviceRows, pactRows, coverageRows, incidentRows, evidenceRows, claimRows, cursors, reconciliationRecords, allCounters };
}

function seedProvider(fake: ReturnType<typeof fakeDb>, id = 1, status: string | null = "ACTIVE"): void {
  fake.providerRows.set(String(id), { id, deploymentId: 1, onchainId: { toString: () => String(id) }, owner: "0x0000000000000000000000000000000000000001", name: `provider-${id}`, status, raw: {}, indexedAt: new Date(id) });
}

function seedClaim(fake: ReturnType<typeof fakeDb>, id: number, status: string | null): void {
  fake.coverageRows.set("1", { id: 1, deploymentId: 1, onchainId: { toString: () => "1" }, pactId: 1, status: "RELEASED", raw: {}, indexedAt: new Date() });
  fake.incidentRows.set("1", { id: 1, deploymentId: 1, onchainId: { toString: () => "1" }, serviceId: 1, status: "FINALIZED", raw: {}, indexedAt: new Date() });
  fake.claimRows.set(String(id), { id: id + 100, deploymentId: 1, onchainId: { toString: () => String(id) }, coverageId: 1, incidentId: 1, claimant: "0x0000000000000000000000000000000000000001", status, raw: {}, indexedAt: new Date(id) });
}

describe("quota-safe onchain indexer", () => {
  it("INDEXER_BOOTSTRAP_AND_IDLE_DOES_NOT_REREAD_IMMUTABLE_ENTITIES", async () => {
    const fake = fakeDb();
    let providerReads = 0;
    const contract = fakeAdapter({ getEntity: async (kind: string) => { if (kind === "provider") providerReads += 1; return kind === "provider" ? { id: "1", owner: "0x0000000000000000000000000000000000000001", name: "provider", status: "ACTIVE" } : {}; } });
    const indexer = new FaultPactIndexer(fake.db, contract, { maxEntityId: 10n });
    await indexer.syncOnce();
    await indexer.syncOnce();
    await new FaultPactIndexer(fake.db, contract, { maxEntityId: 10n }).syncOnce();
    expect(fake.providerRows.size).toBe(1);
    expect(providerReads).toBe(1);
    expect(fake.reconciliationRecords.some((record) => record.action === "LEGACY_CURSOR_REPAIRED")).toBe(true);
  });

  it("PROCESS_RESTART_USES_THE_CACHED_VERIFIED_DEPLOYMENT", async () => {
    const fake = fakeDb();
    const verifyDeployment = vi.fn(async () => { throw new Error("live verification must not run"); });
    await new FaultPactIndexer(fake.db, fakeAdapter({ verifyDeployment })).syncOnce();
    expect(verifyDeployment).not.toHaveBeenCalled();
  });

  it("INDEXER_NEW_ENTITY_ADVANCES_FROM_THE_PERSISTED_CURSOR", async () => {
    const fake = fakeDb();
    let limit = 1;
    const reads: string[] = [];
    const contract = fakeAdapter({ getCounters: async () => fake.allCounters({ provider: limit }), getEntity: async (kind: string, id: bigint) => { reads.push(`${kind}:${id}`); return kind === "provider" ? { id: id.toString(), owner: "0x0000000000000000000000000000000000000001", name: "provider", status: "ACTIVE" } : {}; } });
    const indexer = new FaultPactIndexer(fake.db, contract, { maxEntityId: 10n });
    await indexer.syncOnce();
    limit = 2;
    await indexer.syncOnce();
    expect(reads.filter((read) => read.startsWith("provider:"))).toEqual(["provider:1", "provider:2"]);
  });

  it("INDEXER_EMPTY_PROJECTION_RETAINS_CURSOR", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async () => ({}) }), { maxEntityId: 10n });
    await expect(indexer.syncOnce()).rejects.toThrow(/projection is empty/);
    expect(String(fake.cursors.get("provider")?.nextId)).toBe("1");
    expect(fake.cursors.get("all")?.status).toBe("DEGRADED");
  });

  it("INDEXER_DEPENDENCY_FAILURE_RECOVERS_WITHOUT_CURSOR_CORRUPTION", async () => {
    const fake = fakeDb();
    let providerAvailable = false;
    const reads: string[] = [];
    const contract = fakeAdapter({
      getCounters: async () => fake.allCounters({ provider: 1, service: 1 }),
      getEntity: async (kind: string) => {
        reads.push(kind);
        if (kind === "provider") return providerAvailable ? { id: "1", owner: "0x0000000000000000000000000000000000000001" } : {};
        return { id: "1", provider_id: "1", name: "service" };
      },
    });
    const indexer = new FaultPactIndexer(fake.db, contract, { maxEntityId: 10n });
    await expect(indexer.syncOnce()).rejects.toThrow(/provider 1 projection is empty/);
    providerAvailable = true;
    await indexer.syncOnce();
    expect(reads).toEqual(["provider", "provider", "service"]);
    expect(String(fake.cursors.get("service")?.nextId)).toBe("2");
  });

  it("INDEXER_TERMINAL_CHILD_FAILURE_DOES_NOT_ADVANCE_CURSOR", async () => {
    const fake = fakeDb();
    let failCapacity = true;
    const contract = fakeAdapter({
      getCounters: async () => fake.allCounters({ provider: 1, service: 1, pact: 1 }),
      getEntity: async (kind: string) => kind === "provider"
        ? { id: "1", owner: "0x0000000000000000000000000000000000000001" }
        : kind === "service" ? { id: "1", provider_id: "1" }
          : { id: "1", service_id: "1", status: "RETIRED" },
      read: async (method: string) => {
        if (method === "get_pact_capacity" && failCapacity) throw new Error("capacity unavailable");
        if (method === "get_pact_capacity") return { allocated: "1", reserved: "0", available: "0" };
        return projectionRead(method);
      },
    });
    const indexer = new FaultPactIndexer(fake.db, contract, { maxEntityId: 10n });
    await expect(indexer.syncOnce()).rejects.toThrow(/capacity unavailable/);
    expect(fake.pactRows.size).toBe(0);
    expect(String(fake.cursors.get("pact")?.nextId)).toBe("1");
    failCapacity = false;
    await indexer.syncOnce();
    expect(fake.pactRows.size).toBe(1);
  });

  it("INDEXER_READS_REGION_SCOPE_FROM_PACT_TERMS", async () => {
    const fake = fakeDb();
    const contract = fakeAdapter({
      getCounters: async () => fake.allCounters({ provider: 1, service: 1, pact: 1 }),
      getEntity: async (kind: string) => kind === "provider"
        ? { id: "1", owner: "0x0000000000000000000000000000000000000001" }
        : kind === "service" ? { id: "1", provider_id: "1" }
          : { id: "1", service_id: "1", provider_id: "1", terms: { region_scope: "us-east" } },
      read: async (method: string) => method === "get_pact_terms" ? { region_scope: "us-east" } : method === "get_pact_capacity" ? { allocated: "0", reserved: "0", available: "0" } : projectionRead(method),
    });
    await new FaultPactIndexer(fake.db, contract, { maxEntityId: 10n }).syncOnce();
    expect([...fake.pactRows.values()][0]?.regionScope).toBe("us-east");
  });

  it("INDEXER_DOES_NOT_CLAIM_EXTERNAL_EVIDENCE_WAS_VERIFIED", async () => {
    const fake = fakeDb();
    const contract = fakeAdapter({
      getCounters: async () => fake.allCounters({ provider: 1, service: 1, incident: 1, evidence: 1 }),
      getEntity: async (kind: string) => kind === "provider"
        ? { id: "1", owner: "0x0000000000000000000000000000000000000001" }
        : kind === "service" ? { id: "1", provider_id: "1" }
          : kind === "incident" ? { id: "1", service_id: "1", status: "FINALIZED" }
            : { id: "1", incident_id: "1", uri: "https://example.com/evidence", content_hash: "a".repeat(64), provenance: "AUTHORITATIVE", reporter_authorized_at_submission: true },
      read: async (method: string) => method === "get_incident_resolution" ? { finalized: true, fact_support: {} } : method === "get_challenge" ? {} : projectionRead(method),
    });
    await new FaultPactIndexer(fake.db, contract, { maxEntityId: 10n }).syncOnce();
    expect([...fake.evidenceRows.values()][0]).toMatchObject({ fetchStatus: "NOT_CHECKED", hashStatus: "NOT_CHECKED", schemaStatus: "NOT_CHECKED", usable: null, artifactSha256: null });
  });

  it("RPC_COOLDOWN_DOES_NOT_CORRUPT_CURSOR", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async () => { throw new Error("GenLayer RPC rate limited; retry after 3600 seconds"); } }), { maxEntityId: 10n });
    await expect(indexer.syncOnce()).rejects.toThrow(/rate limited/);
    expect(String(fake.cursors.get("provider")?.nextId)).toBe("1");
  });

  it("RECONCILE_ONLY_REFRESHES_PENDING_OR_UNKNOWN_CLAIMS", async () => {
    const fake = fakeDb();
    seedClaim(fake, 1, "SETTLED");
    seedClaim(fake, 2, null);
    let reads = 0;
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async (kind: string) => { reads += 1; return { id: "2", coverage_id: "1", incident_id: "1", status: "SETTLED" }; } }), { deploymentId: 1, reconcileLimit: 10 });
    await indexer.reconcile();
    expect(reads).toBe(1);
    expect(fake.cursors.get("reconciliation")?.status).toBe("HEALTHY");
  });

  it("INDEXER_RECONCILIATION_CONTRACT_WINS_WITH_ATOMIC_AUDIT", async () => {
    const fake = fakeDb();
    seedClaim(fake, 1, "PENDING_RESOLUTION");
    const anomalies = await new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async (kind: string) => kind === "claim" ? { id: "1", coverage_id: "1", incident_id: "1", status: "SETTLED" } : {} }), { deploymentId: 1 }).reconcile();
    expect(anomalies).toBe(1);
    expect([...fake.claimRows.values()][0]?.status).toBe("SETTLED");
    expect(fake.reconciliationRecords.some((record) => record.action === "CHAIN_WINS")).toBe(true);
  });

  it("RECONCILE_INCLUDES_RETIRED_SERVICE_PACT_AND_EXPIRED_COVERAGE", async () => {
    const fake = fakeDb();
    seedProvider(fake, 1);
    fake.serviceRows.set("1", { id: 1, deploymentId: 1, onchainId: { toString: () => "1" }, providerId: null, status: "RETIRED", raw: {}, indexedAt: new Date() });
    fake.pactRows.set("1", { id: 1, deploymentId: 1, onchainId: { toString: () => "1" }, serviceId: 1, status: "RETIRED", raw: {}, indexedAt: new Date() });
    fake.coverageRows.set("1", { id: 1, deploymentId: 1, onchainId: { toString: () => "1" }, pactId: 1, status: "EXPIRED", raw: {}, indexedAt: new Date() });
    const reads: string[] = [];
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({
      getEntity: async (kind: string) => {
        reads.push(kind);
        if (kind === "provider") return { id: "1", owner: "0x0000000000000000000000000000000000000001", status: "ACTIVE" };
        if (kind === "service") return { id: "1", provider_id: "1", status: "RETIRED" };
        if (kind === "pact") return { id: "1", service_id: "1", status: "RETIRED" };
        if (kind === "coverage") return { id: "1", pact_id: "1", status: "RELEASED" };
        return {};
      },
      read: async (method: string) => method === "get_pact_terms" ? { region_scope: "global" } : method === "get_pact_capacity" ? { allocated: "0", reserved: "0", available: "0" } : projectionRead(method),
    }), { deploymentId: 1, reconcileLimit: 10 });
    await indexer.reconcile();
    expect(reads).toEqual(expect.arrayContaining(["service", "pact", "coverage"]));
  });

  it("FINALIZED_ENTITY_NOT_RECONCILED_EVERY_MINUTE", async () => {
    const fake = fakeDb();
    fake.incidentRows.set("1", { id: 1, deploymentId: 1, onchainId: { toString: () => "1" }, serviceId: 1, status: "FINALIZED", raw: {}, indexedAt: new Date() });
    let reads = 0;
    await new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async () => { reads += 1; return {}; } }), { deploymentId: 1 }).reconcile();
    expect(reads).toBe(0);
  });

  it("RECONCILE_GLOBAL_LIMIT_AND_ROUND_ROBIN_ARE_BOUNDED", async () => {
    const fake = fakeDb();
    for (let id = 1; id <= 8; id += 1) seedProvider(fake, id);
    let reads = 0;
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async (kind: string) => { reads += 1; return kind === "provider" ? { id: "1", owner: "0x0000000000000000000000000000000000000001" } : {}; } }), { deploymentId: 1, reconcileLimit: 3 });
    await indexer.reconcile();
    expect(reads).toBe(3);
  });

  it("RECONCILIATION_FAILURE_DEGRADES_DURABLE_HEALTH", async () => {
    const fake = fakeDb();
    seedProvider(fake, 1);
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter({ getEntity: async () => { throw new Error("temporary projection failure"); } }), { deploymentId: 1 });
    await expect(indexer.reconcile()).rejects.toThrow(/temporary projection failure/);
    expect(fake.cursors.get("reconciliation")).toMatchObject({ status: "DEGRADED", lastError: "temporary projection failure" });
  });

  it("RPC_COOLDOWN_PREVENTS_INDEXER_AND_RECONCILIATION_EXECUTION", async () => {
    const fake = fakeDb();
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter(), { rpcCooldownUntil: async () => Date.now() + 30_000 });
    const sync = vi.spyOn(indexer, "syncOnce");
    const reconcile = vi.spyOn(indexer, "reconcile");
    const controller = new AbortController();
    const run = indexer.run(10, 10, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await run;
    expect(sync).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("RPC_COOLDOWN_LOG_SUPPRESSION", async () => {
    const fake = fakeDb();
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const indexer = new FaultPactIndexer(fake.db, fakeAdapter(), { rpcCooldownUntil: () => Date.now() + 30_000, logger: logger as never });
    const controller = new AbortController();
    const run = indexer.run(10, 10, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await run;
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
