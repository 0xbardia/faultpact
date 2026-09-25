import type { PrismaClient, Prisma } from "@prisma/client";
import { FaultPactContractAdapter, FROZEN_SOURCE_SHA256, type RpcRequestOptions } from "@faultpact/contract";
import { decimal, ensureDeployment } from "@faultpact/db";
import { asBigInt, jsonSafe, normalizeAddress, sleep } from "@faultpact/shared";
import type { Logger } from "pino";

type EntityKind = "provider" | "service" | "pact" | "coverage" | "incident" | "evidence" | "claim";
type ReconciliationCandidate = { kind: EntityKind; id: number; onchainId: { toString(): string }; status: string | null };
type ProjectionAudit = { dbStatus: string | null; chainStatus: string | null };

const entityKinds: EntityKind[] = ["provider", "service", "pact", "coverage", "incident", "evidence", "claim"];
const counterAliases: Record<EntityKind, string[]> = {
  provider: ["next_provider_id", "provider_count", "providers"],
  service: ["next_service_id", "service_count", "services"],
  pact: ["next_pact_id", "pact_count", "pacts"],
  coverage: ["next_coverage_id", "coverage_count", "coverages"],
  incident: ["next_incident_id", "incident_count", "incidents"],
  evidence: ["next_evidence_id", "evidence_count", "evidence"],
  claim: ["next_claim_id", "claim_count", "claims"],
};

function field(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) if (name in record) return record[name];
  return undefined;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function idOf(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  try { return asBigInt(value); }
  catch {
    if (typeof value === "object" && value !== null && "toString" in value) {
      const text = String((value as { toString: () => string }).toString());
      if (/^\d+$/.test(text)) return BigInt(text);
    }
    return undefined;
  }
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRpcRateLimit(message: string): boolean {
  return /\b429\b|cooldown|rate limit|daily budget|budget state|scheduler state/i.test(message);
}

function addressOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { return normalizeAddress(value); } catch { return undefined; }
}

function dateOf(value: unknown): Date | undefined {
  const seconds = idOf(value);
  if (seconds === undefined || seconds > 8_640_000_000_000n) return undefined;
  return new Date(Number(seconds) * 1000);
}

function decimalOrNull(value: unknown): Prisma.Decimal | null {
  const integer = idOf(value);
  return integer === undefined ? null : decimal(integer);
}

function jsonInput(value: unknown): Prisma.InputJsonValue { return jsonSafe(value) as Prisma.InputJsonValue; }

function counterLimit(counters: Record<string, unknown>, kind: EntityKind): bigint {
  const entries = Object.entries(counters);
  for (const alias of counterAliases[kind]) {
    const exact = entries.find(([key]) => key.toLowerCase() === alias);
    if (exact) {
      const value = idOf(exact[1]);
      if (value !== undefined) return alias.startsWith("next_") ? (value > 0n ? value - 1n : 0n) : value;
    }
  }
  const fuzzy = entries.find(([key]) => key.toLowerCase().includes(kind));
  const value = fuzzy ? idOf(fuzzy[1]) : undefined;
  if (value === undefined) throw new Error(`Missing or invalid ${kind} counter`);
  const next = fuzzy?.[0].toLowerCase().includes("next");
  return next ? (value > 0n ? value - 1n : 0n) : value;
}

function roundRobin(groups: ReconciliationCandidate[][], limit: number): ReconciliationCandidate[] {
  const selected: ReconciliationCandidate[] = [];
  const depth = Math.max(0, ...groups.map((group) => group.length));
  for (let position = 0; position < depth && selected.length < limit; position += 1) {
    for (const group of groups) {
      const candidate = group[position];
      if (candidate) selected.push(candidate);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function projectionRecord(value: unknown, label: string, required = true): Record<string, unknown> {
  const record = recordOf(value);
  if (required && Object.keys(record).length === 0) throw new Error(`${label} projection is empty`);
  return record;
}

export type IndexerOptions = {
  deploymentId?: number;
  maxEntityId?: bigint;
  rpcCooldownUntil?: () => number | Promise<number>;
  configRefreshIntervalMs?: number;
  reconcileLimit?: number;
  logger?: Logger;
};

export class FaultPactIndexer {
  private deploymentId?: number;
  private running = false;
  private lastConfigAt = 0;
  private cooldownLogged = false;
  private suppressedJobs = 0;

  constructor(private readonly db: PrismaClient, private readonly contract: FaultPactContractAdapter, private readonly options: IndexerOptions = {}) {
    this.deploymentId = options.deploymentId;
  }

  private get log(): Logger | undefined { return this.options.logger; }

  async ensureDeployment(): Promise<number> {
    if (this.deploymentId) return this.deploymentId;
    const existing = await this.db.deployment.findFirst({ where: { chainId: this.contract.chainId, contractAddress: this.contract.address.toLowerCase() }, orderBy: { id: "asc" } });
    if (existing) {
      if (existing.sourceSha256 !== FROZEN_SOURCE_SHA256 || !existing.verifiedAt) throw new Error("Persisted FaultPact deployment does not match the frozen verified source");
      this.deploymentId = existing.id;
      return existing.id;
    }
    const verification = await this.contract.verifyDeployment(undefined, { checkSchema: false });
    const deployment = await ensureDeployment(this.db, {
      network: "GenLayer Studio Development Preview",
      chainId: verification.chainId,
      contractAddress: this.contract.address,
      sourceSha256: verification.sourceSha256,
      sourceByteLength: verification.sourceByteLength,
      schemaFingerprint: verification.schemaFingerprint,
      schema: this.contract.schema,
    });
    this.deploymentId = deployment.id;
    return deployment.id;
  }

  async syncOnce(): Promise<{ deploymentId: number; counters: Record<string, unknown>; indexed: Record<string, number> }> {
    const deploymentId = await this.ensureDeployment();
    try {
      const counters = recordOf(await this.contract.getCounters({ subsystem: "indexer" }));
      const configInterval = this.options.configRefreshIntervalMs ?? 1_800_000;
      if (Date.now() - this.lastConfigAt >= configInterval) {
        const config = recordOf(await this.contract.getProtocolConfig({ subsystem: "indexer" }));
        await this.db.protocolSnapshot.upsert({
          where: { deploymentId },
          create: { deploymentId, raw: jsonInput(config) },
          update: { raw: jsonInput(config), capturedAt: new Date() },
        });
        await this.db.contractSnapshot.create({ data: { deploymentId, chainId: this.contract.chainId, config: jsonInput(config), counters: jsonInput(counters) } });
        this.lastConfigAt = Date.now();
      }

      const forceFromStart = await this.needsLegacyCursorRepair(deploymentId);
      const indexed: Record<string, number> = {};
      const failures: string[] = [];
      for (const kind of entityKinds) {
        const result = await this.syncKind(deploymentId, kind, counterLimit(counters, kind), forceFromStart);
        indexed[kind] = result.count;
        if (result.error) {
          failures.push(`${kind}: ${result.error}`);
          break;
        }
      }
      if (failures.length === 0 && forceFromStart) {
        await this.db.reconciliationRecord.create({
          data: {
            entityKind: "cursor",
            entityId: decimal(0),
            dbStatus: "LEGACY",
            chainStatus: "VERIFIED",
            action: "LEGACY_CURSOR_REPAIRED",
            details: jsonInput({ deploymentId, completedAt: new Date().toISOString(), entityKinds }),
          },
        });
        this.log?.info({ deploymentId, entityKinds }, "legacy entity cursors repaired and verified");
      }
      const now = new Date();
      const lastError = failures.length ? failures.join("; ").slice(0, 2000) : null;
      await this.db.syncCursor.upsert({
        where: { deploymentId_entityKind: { deploymentId, entityKind: "all" } },
        create: { deploymentId, entityKind: "all", nextId: decimal(0), lastSuccessAt: lastError ? null : now, lastError, status: lastError ? "DEGRADED" : "HEALTHY" },
        update: { ...(lastError ? {} : { lastSuccessAt: now }), lastError, status: lastError ? "DEGRADED" : "HEALTHY" },
      });
      if (lastError) throw new Error(lastError);
      return { deploymentId, counters, indexed };
    } catch (error) {
      const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      await this.db.syncCursor.upsert({
        where: { deploymentId_entityKind: { deploymentId, entityKind: "all" } },
        create: { deploymentId, entityKind: "all", nextId: decimal(0), lastSuccessAt: null, lastError, status: "DEGRADED" },
        update: { lastError, status: "DEGRADED" },
      });
      throw error;
    }
  }

  private async needsLegacyCursorRepair(deploymentId: number): Promise<boolean> {
    const records = await this.db.reconciliationRecord.findMany({
      where: { entityKind: "cursor", action: "LEGACY_CURSOR_REPAIRED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { details: true },
    });
    return !records.some((record) => idOf(record.details && typeof record.details === "object" ? (record.details as Record<string, unknown>).deploymentId : undefined) === BigInt(deploymentId));
  }

  private async syncKind(deploymentId: number, kind: EntityKind, limit: bigint, forceFromStart: boolean): Promise<{ count: number; error: string | null }> {
    const maxEntityId = this.options.maxEntityId ?? 100_000n;
    const bounded = limit > maxEntityId ? maxEntityId : limit;
    const capError = limit > maxEntityId ? `${kind} counter ${limit.toString()} exceeds safety cap ${maxEntityId.toString()}` : null;
    const cursor = await this.db.syncCursor.findUnique({ where: { deploymentId_entityKind: { deploymentId, entityKind: kind } }, select: { nextId: true } });
    let nextId = forceFromStart ? 1n : idOf(cursor?.nextId) ?? 1n;
    if (nextId < 1n) nextId = 1n;
    let count = 0;
    let lastError: string | null = capError;
    if (nextId <= bounded) {
      for (let id = nextId; id <= bounded; id += 1n) {
        try {
          const value = await this.contract.getEntity(kind, id, { subsystem: "indexer" });
          await this.upsert(kind, deploymentId, id, value, { subsystem: "indexer" });
          count += 1;
          nextId = id + 1n;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          this.log?.warn({ kind, id: id.toString(), err: lastError }, "entity projection failed; cursor retained");
          nextId = id;
          break;
        }
      }
    }
    await this.db.syncCursor.upsert({
      where: { deploymentId_entityKind: { deploymentId, entityKind: kind } },
      create: { deploymentId, entityKind: kind, nextId: decimal(nextId), lastSuccessAt: lastError ? null : new Date(), lastError, status: lastError ? "DEGRADED" : "HEALTHY" },
      update: { nextId: decimal(nextId), ...(lastError ? {} : { lastSuccessAt: new Date() }), lastError, status: lastError ? "DEGRADED" : "HEALTHY" },
    });
    return { count, error: lastError };
  }

  private async upsert(kind: EntityKind, deploymentId: number, onchainId: bigint, value: unknown, request: RpcRequestOptions & { audit?: ProjectionAudit }): Promise<void> {
    const raw = recordOf(value);
    if (Object.keys(raw).length === 0) throw new Error(`${kind} ${onchainId.toString()} projection is empty`);
    const now = new Date();
    const common = { deploymentId, onchainId: decimal(onchainId), raw: jsonInput(raw), indexedAt: now };
    const writeAudit = async (tx: Prisma.TransactionClient): Promise<void> => {
      if (!request.audit || request.audit.dbStatus === request.audit.chainStatus) return;
      await tx.reconciliationRecord.create({
        data: {
          entityKind: kind,
          entityId: decimal(onchainId),
          dbStatus: request.audit.dbStatus,
          chainStatus: request.audit.chainStatus,
          action: "CHAIN_WINS",
          details: jsonInput({ deploymentId, onchainId: onchainId.toString() }),
        },
      });
    };

    switch (kind) {
      case "provider": {
        const vault = this.contract.schema.methods["get_provider_vault"] ? projectionRecord(await this.contract.read("get_provider_vault", [onchainId], request), "provider vault") : undefined;
        const stats = this.contract.schema.methods["get_provider_stats"] ? projectionRecord(await this.contract.read("get_provider_stats", [onchainId], request), "provider stats") : undefined;
        await this.db.$transaction(async (tx) => {
          const provider = await tx.provider.upsert({
            where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } },
            create: { ...common, address: addressOf(field(raw, "owner", "provider", "address")), name: stringOf(field(raw, "name")), status: stringOf(field(raw, "status")) },
            update: { address: addressOf(field(raw, "owner", "provider", "address")), name: stringOf(field(raw, "name")), status: stringOf(field(raw, "status")), raw: jsonInput(raw), indexedAt: now },
            select: { id: true },
          });
          if (vault && stats) {
            await tx.providerVault.upsert({
              where: { providerId: provider.id },
              create: { providerId: provider.id, totalCapital: decimal(idOf(field(vault, "total_capital", "totalCapital")) ?? 0n), allocated: decimal(idOf(field(vault, "allocated_capital", "allocated")) ?? 0n), reserved: decimal(idOf(field(vault, "reserved_capital", "reserved")) ?? 0n), pending: decimal(idOf(field(vault, "pending_withdrawal", "pending")) ?? 0n), raw: jsonInput(vault), indexedAt: now },
              update: { totalCapital: decimal(idOf(field(vault, "total_capital", "totalCapital")) ?? 0n), allocated: decimal(idOf(field(vault, "allocated_capital", "allocated")) ?? 0n), reserved: decimal(idOf(field(vault, "reserved_capital", "reserved")) ?? 0n), pending: decimal(idOf(field(vault, "pending_withdrawal", "pending")) ?? 0n), raw: jsonInput(vault), indexedAt: now },
            });
            const statsData = { totalPacts: decimalOrNull(field(stats, "total_pacts", "totalPacts")), totalCoverages: decimal(idOf(field(stats, "total_coverages", "totalCoverages")) ?? 0n), finalizedIncidents: decimal(idOf(field(stats, "total_incidents", "finalized_incidents", "finalizedIncidents")) ?? 0n), providerFaultIncidents: decimal(idOf(field(stats, "provider_fault_incidents", "providerFaultIncidents")) ?? 0n), raw: jsonInput(stats) };
            await tx.providerStats.upsert({ where: { providerId: provider.id }, create: { providerId: provider.id, ...statsData }, update: { ...statsData, indexedAt: now } });
          }
          await writeAudit(tx);
        });
        return;
      }
      case "service": {
        const providerOnchainId = idOf(field(raw, "provider_id", "providerId"));
        const provider = providerOnchainId === undefined ? null : await this.db.provider.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(providerOnchainId) } }, select: { id: true } });
        if (providerOnchainId !== undefined && !provider) throw new Error(`service ${onchainId.toString()} references missing provider ${providerOnchainId.toString()}`);
        await this.db.$transaction(async (tx) => {
          await tx.service.upsert({
            where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } },
            create: { ...common, providerId: provider?.id, serviceType: stringOf(field(raw, "service_type", "serviceType")), name: stringOf(field(raw, "name")), status: stringOf(field(raw, "status")), metadataUri: stringOf(field(raw, "metadata_uri")), metadataHash: stringOf(field(raw, "metadata_hash")) },
            update: { providerId: provider?.id, serviceType: stringOf(field(raw, "service_type", "serviceType")), name: stringOf(field(raw, "name")), status: stringOf(field(raw, "status")), metadataUri: stringOf(field(raw, "metadata_uri")), metadataHash: stringOf(field(raw, "metadata_hash")), raw: jsonInput(raw), indexedAt: now },
          });
          await writeAudit(tx);
        });
        return;
      }
      case "pact": {
        const serviceOnchainId = idOf(field(raw, "service_id", "serviceId"));
        if (serviceOnchainId === undefined) throw new Error(`pact ${onchainId.toString()} has no service ID`);
        const service = await this.db.service.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(serviceOnchainId) } }, select: { id: true } });
        if (!service) throw new Error(`pact ${onchainId.toString()} references missing service ${serviceOnchainId.toString()}`);
        const providerOnchainId = idOf(field(raw, "provider_id", "providerId"));
        const provider = providerOnchainId === undefined ? null : await this.db.provider.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(providerOnchainId) } }, select: { id: true } });
        if (providerOnchainId !== undefined && !provider) throw new Error(`pact ${onchainId.toString()} references missing provider ${providerOnchainId.toString()}`);
        const terms = projectionRecord(await this.contract.read("get_pact_terms", [onchainId], request), "pact terms");
        const capacity = projectionRecord(await this.contract.read("get_pact_capacity", [onchainId], request), "pact capacity");
        const regionScope = stringOf(field(raw, "region_scope", "regionScope")) ?? stringOf(field(recordOf(field(raw, "terms")), "region_scope", "regionScope"));
        await this.db.$transaction(async (tx) => {
          const pact = await tx.pact.upsert({
            where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } },
            create: { ...common, serviceId: service.id, providerId: provider?.id, revision: decimal(idOf(field(raw, "revision")) ?? 0n), status: stringOf(field(raw, "status")), regionScope },
            update: { serviceId: service.id, providerId: provider?.id, revision: decimal(idOf(field(raw, "revision")) ?? 0n), status: stringOf(field(raw, "status")), regionScope, raw: jsonInput(raw), indexedAt: now },
            select: { id: true },
          });
          const termData = { availabilityThresholdPpm: decimalOrNull(field(terms, "availability_threshold_ppm", "availabilityThresholdPpm")), p95LatencyMs: decimalOrNull(field(terms, "p95_latency_ms", "p95LatencyMs")), errorRateThresholdPpm: decimalOrNull(field(terms, "error_rate_threshold_ppm", "errorRateThresholdPpm")), blockLagThreshold: decimalOrNull(field(terms, "block_lag_threshold", "blockLagThreshold")), minIncidentDurationSeconds: decimalOrNull(field(terms, "min_incident_duration_seconds", "minIncidentDurationSeconds")), claimWindowSeconds: decimalOrNull(field(terms, "claim_window_seconds", "claimWindowSeconds")), minCoverageDurationSeconds: decimalOrNull(field(terms, "min_coverage_duration_seconds", "minCoverageDurationSeconds")), maxCoverageDurationSeconds: decimalOrNull(field(terms, "max_coverage_duration_seconds", "maxCoverageDurationSeconds")), minCoverageAmount: decimalOrNull(field(terms, "min_coverage_amount", "minCoverageAmount")), maxCoverageAmount: decimalOrNull(field(terms, "max_coverage_amount", "maxCoverageAmount")), premiumBpsPerYear: decimalOrNull(field(terms, "premium_bps_per_year", "premiumBpsPerYear")), deductibleBps: decimalOrNull(field(terms, "deductible_bps", "deductibleBps")), maxPayoutBps: decimalOrNull(field(terms, "max_payout_bps", "maxPayoutBps")), termsUri: stringOf(field(terms, "terms_uri", "termsUri")), termsHash: stringOf(field(terms, "terms_hash", "termsHash")), raw: jsonInput(terms) };
          await tx.pactTerms.upsert({ where: { pactId: pact.id }, create: { pactId: pact.id, ...termData }, update: { ...termData, indexedAt: now } });
          const capacityData = { totalAllocated: decimal(idOf(field(capacity, "allocated", "allocated_capital", "total_allocated")) ?? 0n), totalReserved: decimal(idOf(field(capacity, "reserved", "reserved_capital", "total_reserved")) ?? 0n), remaining: decimal(idOf(field(capacity, "available", "remaining_limit", "remaining")) ?? 0n), raw: jsonInput(capacity) };
          await tx.pactCapacity.upsert({ where: { pactId: pact.id }, create: { pactId: pact.id, ...capacityData }, update: { ...capacityData, indexedAt: now } });
          await writeAudit(tx);
        });
        return;
      }
      case "coverage": {
        const pactOnchainId = idOf(field(raw, "pact_id", "pactId"));
        if (pactOnchainId === undefined) throw new Error(`coverage ${onchainId.toString()} has no pact ID`);
        const pact = await this.db.pact.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(pactOnchainId) } }, select: { id: true } });
        if (!pact) throw new Error(`coverage ${onchainId.toString()} references missing pact ${pactOnchainId.toString()}`);
        const coverageData = { pactId: pact.id, buyerAddress: addressOf(field(raw, "buyer", "buyer_address", "customer")), status: stringOf(field(raw, "status")), coverageLimit: decimal(idOf(field(raw, "coverage_limit", "limit")) ?? 0n), startAt: dateOf(field(raw, "start_ts", "start_at")), endAt: dateOf(field(raw, "end_ts", "end_at")), raw: jsonInput(raw) };
        await this.db.$transaction(async (tx) => {
          await tx.coverage.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, ...coverageData }, update: { ...coverageData, indexedAt: now } });
          await writeAudit(tx);
        });
        return;
      }
      case "incident": {
        const serviceOnchainId = idOf(field(raw, "service_id", "serviceId"));
        if (serviceOnchainId === undefined) throw new Error(`incident ${onchainId.toString()} has no service ID`);
        const service = await this.db.service.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(serviceOnchainId) } }, select: { id: true } });
        if (!service) throw new Error(`incident ${onchainId.toString()} references missing service ${serviceOnchainId.toString()}`);
        const status = stringOf(field(raw, "status"));
        const resolution = recordOf(await this.contract.read("get_incident_resolution", [onchainId], request));
        if (status === "FINALIZED" && Object.keys(resolution).length === 0) throw new Error(`finalized incident ${onchainId.toString()} has no resolution projection`);
        const challenge = this.contract.schema.methods["get_challenge"] ? recordOf(await this.contract.read("get_challenge", [onchainId], request)) : {};
        await this.db.$transaction(async (tx) => {
          const incident = await tx.incident.upsert({
            where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } },
            create: { ...common, serviceId: service.id, status, observedStart: decimal(idOf(field(raw, "observed_start")) ?? 0n), observedEnd: decimal(idOf(field(raw, "observed_end")) ?? 0n), reportBond: decimal(idOf(field(raw, "report_bond")) ?? 0n), challengeBond: decimal(idOf(field(raw, "challenge_bond")) ?? 0n), openClaims: decimal(idOf(field(raw, "open_claims")) ?? 0n) },
            update: { serviceId: service.id, status, observedStart: decimal(idOf(field(raw, "observed_start")) ?? 0n), observedEnd: decimal(idOf(field(raw, "observed_end")) ?? 0n), reportBond: decimal(idOf(field(raw, "report_bond")) ?? 0n), challengeBond: decimal(idOf(field(raw, "challenge_bond")) ?? 0n), openClaims: decimal(idOf(field(raw, "open_claims")) ?? 0n), raw: jsonInput(raw), indexedAt: now },
            select: { id: true },
          });
          if (Object.keys(resolution).length > 0) {
            const resolutionStatus = stringOf(field(resolution, "status")) ?? (field(resolution, "finalized") === true ? "FINALIZED" : "PRELIMINARY");
            const resolutionData = { status: resolutionStatus, factStatus: stringOf(field(resolution, "fact_status")), faultDomain: stringOf(field(resolution, "fault_domain")), scope: stringOf(field(resolution, "scope")), incidentStart: decimal(idOf(field(resolution, "incident_start")) ?? 0n), incidentEnd: decimal(idOf(field(resolution, "incident_end")) ?? 0n), duration: decimal(idOf(field(resolution, "duration_seconds")) ?? 0n), p95LatencyMs: decimal(idOf(field(resolution, "observed_p95_latency_ms")) ?? 0n), availabilityPpm: decimal(idOf(field(resolution, "observed_availability_ppm")) ?? 0n), errorRatePpm: decimal(idOf(field(resolution, "observed_error_rate_ppm")) ?? 0n), blockLag: decimal(idOf(field(resolution, "observed_block_lag")) ?? 0n), supportIds: jsonInput(field(resolution, "fact_support") ?? {}), raw: jsonInput(resolution), indexedAt: now };
            await tx.incidentResolution.upsert({ where: { incidentId: incident.id }, create: { incidentId: incident.id, ...resolutionData }, update: { ...resolutionData, indexedAt: now } });
          }
          if (Object.keys(challenge).length > 0 && field(challenge, "exists") !== false) {
            const challengeStatus = stringOf(field(challenge, "status")) ?? (field(challenge, "resolved") === true ? "RESOLVED" : "OPEN");
            await tx.challenge.upsert({ where: { incidentId: incident.id }, create: { deploymentId, incidentId: incident.id, challenger: addressOf(field(challenge, "challenger", "challenger_address")), status: challengeStatus, challengeBond: decimal(idOf(field(challenge, "bond", "challenge_bond")) ?? 0n), raw: jsonInput(challenge), indexedAt: now }, update: { challenger: addressOf(field(challenge, "challenger", "challenger_address")), status: challengeStatus, challengeBond: decimal(idOf(field(challenge, "bond", "challenge_bond")) ?? 0n), raw: jsonInput(challenge), indexedAt: now } });
          }
          await writeAudit(tx);
        });
        return;
      }
      case "evidence": {
        const incidentOnchainId = idOf(field(raw, "incident_id", "incidentId"));
        if (incidentOnchainId === undefined) throw new Error(`evidence ${onchainId.toString()} has no incident ID`);
        const incident = await this.db.incident.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(incidentOnchainId) } }, select: { id: true } });
        if (!incident) throw new Error(`evidence ${onchainId.toString()} references missing incident ${incidentOnchainId.toString()}`);
        const evidenceData = { incidentId: incident.id, evidenceType: stringOf(field(raw, "evidence_type", "evidenceType")), evidenceUri: stringOf(field(raw, "uri", "evidence_uri")), contentHash: stringOf(field(raw, "content_hash", "contentHash")), description: stringOf(field(raw, "description")), reporter: addressOf(field(raw, "submitter", "reporter")), authoritative: field(raw, "provenance") === "AUTHORITATIVE", reporterAuthorized: field(raw, "reporter_authorized_at_submission") === true, fetchStatus: "NOT_CHECKED", hashStatus: "NOT_CHECKED", schemaStatus: "NOT_CHECKED", usable: null, artifactSha256: null, raw: jsonInput(raw), indexedAt: now };
        await this.db.$transaction(async (tx) => {
          await tx.evidence.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, ...evidenceData }, update: evidenceData });
          await writeAudit(tx);
        });
        return;
      }
      case "claim": {
        const coverageOnchainId = idOf(field(raw, "coverage_id", "coverageId"));
        const incidentOnchainId = idOf(field(raw, "incident_id", "incidentId"));
        if (coverageOnchainId === undefined || incidentOnchainId === undefined) throw new Error(`claim ${onchainId.toString()} has incomplete parent IDs`);
        const [coverage, incident] = await Promise.all([
          this.db.coverage.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(coverageOnchainId) } }, select: { id: true } }),
          this.db.incident.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(incidentOnchainId) } }, select: { id: true } }),
        ]);
        if (!coverage || !incident) throw new Error(`claim ${onchainId.toString()} references a missing parent projection`);
        const claimData = { coverageId: coverage.id, incidentId: incident.id, claimant: addressOf(field(raw, "claimant", "buyer")), status: stringOf(field(raw, "status")), payout: decimal(idOf(field(raw, "payout", "settled_amount")) ?? 0n), raw: jsonInput(raw), indexedAt: now };
        await this.db.$transaction(async (tx) => {
          await tx.claim.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, ...claimData }, update: claimData });
          await writeAudit(tx);
        });
        return;
      }
    }
  }

  private async markReconciliation(deploymentId: number, error: string | null): Promise<void> {
    await this.db.syncCursor.upsert({
      where: { deploymentId_entityKind: { deploymentId, entityKind: "reconciliation" } },
      create: { deploymentId, entityKind: "reconciliation", nextId: decimal(0), lastSuccessAt: error ? null : new Date(), lastError: error, status: error ? "DEGRADED" : "HEALTHY" },
      update: { ...(error ? {} : { lastSuccessAt: new Date() }), lastError: error, status: error ? "DEGRADED" : "HEALTHY" },
    });
  }

  async reconcile(): Promise<number> {
    const deploymentId = await this.ensureDeployment();
    const limit = Math.max(1, Math.min(100, this.options.reconcileLimit ?? 10));
    try {
      const [providers, services, pacts, coverages, incidents, claims] = await Promise.all([
        this.db.provider.findMany({ where: { deploymentId }, take: limit, orderBy: { indexedAt: "asc" }, select: { id: true, onchainId: true, status: true } }),
        this.db.service.findMany({ where: { deploymentId }, take: limit, orderBy: { indexedAt: "asc" }, select: { id: true, onchainId: true, status: true } }),
        this.db.pact.findMany({ where: { deploymentId }, take: limit, orderBy: { indexedAt: "asc" }, select: { id: true, onchainId: true, status: true } }),
        this.db.coverage.findMany({ where: { deploymentId, OR: [{ status: { not: "RELEASED" } }, { status: null }] }, take: limit, orderBy: { indexedAt: "asc" }, select: { id: true, onchainId: true, status: true } }),
        this.db.incident.findMany({ where: { deploymentId, OR: [{ status: { not: "FINALIZED" } }, { status: null }] }, take: limit, orderBy: { indexedAt: "asc" }, select: { id: true, onchainId: true, status: true } }),
        this.db.claim.findMany({ where: { deploymentId, OR: [{ status: "PENDING_RESOLUTION" }, { status: null }] }, take: limit, orderBy: { indexedAt: "asc" }, select: { id: true, onchainId: true, status: true } }),
      ]);
      const toCandidate = (kind: EntityKind, rows: Array<{ id: number; onchainId: { toString(): string }; status: string | null }>): ReconciliationCandidate[] => rows.map((row) => ({ kind, id: row.id, onchainId: row.onchainId, status: row.status }));
      const candidates = roundRobin([
        toCandidate("provider", providers),
        toCandidate("service", services),
        toCandidate("pact", pacts),
        toCandidate("coverage", coverages),
        toCandidate("incident", incidents),
        toCandidate("claim", claims),
      ], limit);
      let anomalies = 0;
      for (const candidate of candidates) {
        const onchainId = BigInt(candidate.onchainId.toString());
        const chain = recordOf(await this.contract.getEntity(candidate.kind, onchainId, { subsystem: "reconciliation" }));
        const chainStatus = stringOf(field(chain, "status"));
        await this.upsert(candidate.kind, deploymentId, onchainId, chain, { subsystem: "reconciliation", audit: { dbStatus: candidate.status, chainStatus: chainStatus ?? null } });
        if (chainStatus && chainStatus !== candidate.status) anomalies += 1;
      }
      await this.markReconciliation(deploymentId, null);
      return anomalies;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      await this.markReconciliation(deploymentId, message);
      throw error;
    }
  }

  private async currentCooldownUntil(): Promise<number> {
    if (!this.options.rpcCooldownUntil) return 0;
    try { return await this.options.rpcCooldownUntil(); }
    catch (error) {
      if (!this.cooldownLogged) this.log?.warn({ err: error }, "RPC scheduler state unreadable; chain jobs paused fail-safe");
      return Date.now() + 60_000;
    }
  }

  async run(pollMs: number, reconcileMs: number, signal: AbortSignal): Promise<void> {
    if (this.running) throw new Error("indexer already running");
    this.running = true;
    let nextReconcile = 0;
    try {
      while (!signal.aborted) {
        const blockedUntil = await this.currentCooldownUntil();
        if (blockedUntil > Date.now()) {
          this.suppressedJobs += 1;
          if (!this.cooldownLogged) {
            this.log?.warn({ cooldownUntil: new Date(blockedUntil).toISOString() }, "Studio RPC entered cooldown; chain jobs suspended");
            this.cooldownLogged = true;
          }
          try { await sleep(Math.max(1_000, blockedUntil - Date.now() + 250), signal); }
          catch { if (!signal.aborted) throw new Error("indexer cooldown wait failed"); }
          continue;
        }
        if (this.cooldownLogged) {
          this.log?.info({ suppressedJobs: this.suppressedJobs }, "Studio RPC cooldown expired; one controlled probe will resume scheduling");
          this.suppressedJobs = 0;
          this.cooldownLogged = false;
        }
        let syncSucceeded = false;
        try { await this.syncOnce(); syncSucceeded = true; }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isRpcRateLimit(message)) {
            this.cooldownLogged = true;
            this.log?.warn({ err: message }, "Studio RPC became unavailable; chain jobs will pause without retry churn");
          } else this.log?.error({ err: error }, "indexer cycle failed");
        }
        const cooldownAfterSync = await this.currentCooldownUntil();
        if (syncSucceeded && cooldownAfterSync <= Date.now() && Date.now() >= nextReconcile) {
          try { await this.reconcile(); }
          catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (isRpcRateLimit(message)) {
              this.cooldownLogged = true;
              this.log?.warn({ err: message }, "Studio RPC became unavailable during reconciliation; chain jobs will pause");
            } else this.log?.error({ err: error }, "reconciliation cycle failed");
          }
          nextReconcile = Date.now() + reconcileMs;
        }
        try { await sleep(pollMs, signal); }
        catch { if (!signal.aborted) throw new Error("indexer poll wait failed"); }
      }
    } finally { this.running = false; }
  }
}
