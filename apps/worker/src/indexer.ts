import type { PrismaClient, Prisma } from "@prisma/client";
import { FaultPactContractAdapter } from "@faultpact/contract";
import { decimal, ensureDeployment, serializeDb } from "@faultpact/db";
import { asBigInt, jsonSafe, normalizeAddress, sleep } from "@faultpact/shared";
import type { Logger } from "pino";

type EntityKind = "provider" | "service" | "pact" | "coverage" | "incident" | "evidence" | "claim";
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
  try { return asBigInt(value); } catch { return undefined; }
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
      if (value !== undefined) return alias.startsWith("next_") ? value - 1n : value;
    }
  }
  const fuzzy = entries.find(([key]) => key.toLowerCase().includes(kind));
  const value = fuzzy ? idOf(fuzzy[1]) : undefined;
  return value === undefined ? 0n : fuzzy?.[0].toLowerCase().includes("next") ? value - 1n : value;
}

export type IndexerOptions = {
  deploymentId?: number;
  maxEntityId?: bigint;
  rpcMinIntervalMs?: number;
  logger?: Logger;
};

export class FaultPactIndexer {
  private deploymentId?: number;
  private running = false;
  private lastRpcAt = 0;
  constructor(private readonly db: PrismaClient, private readonly contract: FaultPactContractAdapter, private readonly options: IndexerOptions = {}) {
    this.deploymentId = options.deploymentId;
  }

  private get log(): Logger | undefined { return this.options.logger; }

  private async rpcCall<T>(operation: () => Promise<T>): Promise<T> {
    const minInterval = this.options.rpcMinIntervalMs ?? 150;
    const elapsed = Date.now() - this.lastRpcAt;
    if (elapsed < minInterval) await sleep(minInterval - elapsed);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      this.lastRpcAt = Date.now();
      try { return await operation(); } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("429") || attempt === 3) throw error;
        await sleep((attempt + 1) * 500);
      }
    }
    throw new Error("unreachable RPC retry state");
  }

  async ensureDeployment(): Promise<number> {
    if (this.deploymentId) return this.deploymentId;
    // Use the checked-in frozen schema at runtime. Full live schema comparison
    // belongs to the controlled certification command.
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
    const counters = recordOf(await this.rpcCall(() => this.contract.getCounters()));
    const config = await this.rpcCall(() => this.contract.getProtocolConfig());
    await this.db.protocolSnapshot.upsert({
      where: { deploymentId },
      create: { deploymentId, raw: jsonInput(config) },
      update: { raw: jsonInput(config), capturedAt: new Date() },
    });
    await this.db.contractSnapshot.create({ data: { deploymentId, chainId: this.contract.chainId, config: jsonInput(config), counters: jsonInput(counters) } });
    const indexed: Record<string, number> = {};
    for (const kind of entityKinds) indexed[kind] = await this.syncKind(deploymentId, kind, counterLimit(counters, kind));
    await this.db.syncCursor.upsert({
      where: { deploymentId_entityKind: { deploymentId, entityKind: "all" } },
      create: { deploymentId, entityKind: "all", nextId: decimal(0), lastSuccessAt: new Date(), status: "HEALTHY" },
      update: { lastSuccessAt: new Date(), lastError: null, status: "HEALTHY" },
    });
    return { deploymentId, counters, indexed };
  }

  private async syncKind(deploymentId: number, kind: EntityKind, limit: bigint): Promise<number> {
    const maxEntityId = this.options.maxEntityId ?? 100_000n;
    const bounded = limit > maxEntityId ? maxEntityId : limit;
    if (bounded < 1n) return 0;
    let count = 0;
    let lastError: string | null = null;
    for (let id = 1n; id <= bounded; id += 1n) {
      try {
        const value = await this.rpcCall(() => this.contract.getEntity(kind, id));
        if (await this.upsert(kind, deploymentId, id, value)) count += 1;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.log?.warn({ kind, id: id.toString(), err: lastError }, "entity fetch failed; retaining existing row");
      }
    }
    await this.db.syncCursor.upsert({
      where: { deploymentId_entityKind: { deploymentId, entityKind: kind } },
      create: { deploymentId, entityKind: kind, nextId: decimal(bounded + 1n), lastSuccessAt: lastError ? null : new Date(), lastError, status: lastError ? "DEGRADED" : "HEALTHY" },
      update: { nextId: decimal(bounded + 1n), ...(lastError ? {} : { lastSuccessAt: new Date() }), lastError, status: lastError ? "DEGRADED" : "HEALTHY" },
    });
    return count;
  }

  private async upsert(kind: EntityKind, deploymentId: number, onchainId: bigint, value: unknown): Promise<boolean> {
    const raw = recordOf(value);
    if (Object.keys(raw).length === 0) return false;
    const common = { deploymentId, onchainId: decimal(onchainId), raw: jsonInput(raw), indexedAt: new Date() };
    switch (kind) {
      case "provider":
        await this.db.provider.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, address: addressOf(field(raw, "owner", "provider", "address")), name: stringOf(field(raw, "name")), status: stringOf(field(raw, "status")) }, update: { address: addressOf(field(raw, "owner", "provider", "address")), name: stringOf(field(raw, "name")), status: stringOf(field(raw, "status")), raw: jsonInput(raw), indexedAt: new Date() } });
        if (this.contract.schema.methods["get_provider_vault"] && this.contract.schema.methods["get_provider_stats"]) {
          const provider = await this.db.provider.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, select: { id: true } });
          if (provider) {
            const vault = recordOf(await this.rpcCall(() => this.contract.read("get_provider_vault", [onchainId])));
            const stats = recordOf(await this.rpcCall(() => this.contract.read("get_provider_stats", [onchainId])));
            await this.db.providerVault.upsert({ where: { providerId: provider.id }, create: { providerId: provider.id, totalCapital: decimal(idOf(field(vault, "total_capital", "totalCapital")) ?? 0n), allocated: decimal(idOf(field(vault, "allocated_capital", "allocated")) ?? 0n), reserved: decimal(idOf(field(vault, "reserved_capital", "reserved")) ?? 0n), pending: decimal(idOf(field(vault, "pending_withdrawal", "pending")) ?? 0n), raw: jsonInput(vault) }, update: { totalCapital: decimal(idOf(field(vault, "total_capital", "totalCapital")) ?? 0n), allocated: decimal(idOf(field(vault, "allocated_capital", "allocated")) ?? 0n), reserved: decimal(idOf(field(vault, "reserved_capital", "reserved")) ?? 0n), pending: decimal(idOf(field(vault, "pending_withdrawal", "pending")) ?? 0n), raw: jsonInput(vault), indexedAt: new Date() } });
            const statsData = { totalPacts: decimalOrNull(field(stats, "total_pacts", "totalPacts")), totalCoverages: decimal(idOf(field(stats, "total_coverages", "totalCoverages")) ?? 0n), finalizedIncidents: decimal(idOf(field(stats, "total_incidents", "finalized_incidents", "finalizedIncidents")) ?? 0n), providerFaultIncidents: decimal(idOf(field(stats, "provider_fault_incidents", "providerFaultIncidents")) ?? 0n), raw: jsonInput(stats) };
            await this.db.providerStats.upsert({ where: { providerId: provider.id }, create: { providerId: provider.id, ...statsData }, update: { ...statsData, indexedAt: new Date() } });
          }
        }
        return true;
      case "service": {
        const providerOnchainId = idOf(field(raw, "provider_id", "providerId"));
        const provider = providerOnchainId === undefined ? null : await this.db.provider.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(providerOnchainId) } }, select: { id: true } });
        if (providerOnchainId !== undefined && !provider) return false;
        await this.db.service.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, providerId: provider?.id, serviceType: stringOf(field(raw, "service_type", "serviceType")), name: stringOf(field(raw, "name")), status: stringOf(field(raw, "status")), metadataUri: stringOf(field(raw, "metadata_uri")), metadataHash: stringOf(field(raw, "metadata_hash")) }, update: { providerId: provider?.id, serviceType: stringOf(field(raw, "service_type", "serviceType")), name: stringOf(field(raw, "name")), status: stringOf(field(raw, "status")), metadataUri: stringOf(field(raw, "metadata_uri")), metadataHash: stringOf(field(raw, "metadata_hash")), raw: jsonInput(raw), indexedAt: new Date() } });
        return true;
      }
      case "pact": {
        const serviceOnchainId = idOf(field(raw, "service_id", "serviceId"));
        if (serviceOnchainId === undefined) return false;
        const service = await this.db.service.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(serviceOnchainId) } }, select: { id: true } });
        if (!service) return false;
        const providerOnchainId = idOf(field(raw, "provider_id", "providerId"));
        const provider = providerOnchainId === undefined ? null : await this.db.provider.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(providerOnchainId) } }, select: { id: true } });
        const pact = await this.db.pact.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, serviceId: service.id, providerId: provider?.id, revision: decimal(idOf(field(raw, "revision")) ?? 0n), status: stringOf(field(raw, "status")), regionScope: stringOf(field(raw, "region_scope", "regionScope")) }, update: { serviceId: service.id, providerId: provider?.id, revision: decimal(idOf(field(raw, "revision")) ?? 0n), status: stringOf(field(raw, "status")), regionScope: stringOf(field(raw, "region_scope", "regionScope")), raw: jsonInput(raw), indexedAt: new Date() } });
        const terms = recordOf(await this.rpcCall(() => this.contract.read("get_pact_terms", [onchainId])));
        const capacity = recordOf(await this.rpcCall(() => this.contract.read("get_pact_capacity", [onchainId])));
        const termData = { availabilityThresholdPpm: decimalOrNull(field(terms, "availability_threshold_ppm", "availabilityThresholdPpm")), p95LatencyMs: decimalOrNull(field(terms, "p95_latency_ms", "p95LatencyMs")), errorRateThresholdPpm: decimalOrNull(field(terms, "error_rate_threshold_ppm", "errorRateThresholdPpm")), blockLagThreshold: decimalOrNull(field(terms, "block_lag_threshold", "blockLagThreshold")), minIncidentDurationSeconds: decimalOrNull(field(terms, "min_incident_duration_seconds", "minIncidentDurationSeconds")), claimWindowSeconds: decimalOrNull(field(terms, "claim_window_seconds", "claimWindowSeconds")), minCoverageDurationSeconds: decimalOrNull(field(terms, "min_coverage_duration_seconds", "minCoverageDurationSeconds")), maxCoverageDurationSeconds: decimalOrNull(field(terms, "max_coverage_duration_seconds", "maxCoverageDurationSeconds")), minCoverageAmount: decimalOrNull(field(terms, "min_coverage_amount", "minCoverageAmount")), maxCoverageAmount: decimalOrNull(field(terms, "max_coverage_amount", "maxCoverageAmount")), premiumBpsPerYear: decimalOrNull(field(terms, "premium_bps_per_year", "premiumBpsPerYear")), deductibleBps: decimalOrNull(field(terms, "deductible_bps", "deductibleBps")), maxPayoutBps: decimalOrNull(field(terms, "max_payout_bps", "maxPayoutBps")), termsUri: stringOf(field(terms, "terms_uri", "termsUri")), termsHash: stringOf(field(terms, "terms_hash", "termsHash")), raw: jsonInput(terms) };
        await this.db.pactTerms.upsert({ where: { pactId: pact.id }, create: { pactId: pact.id, ...termData }, update: { ...termData, indexedAt: new Date() } });
        const capacityData = { totalAllocated: decimal(idOf(field(capacity, "allocated", "allocated_capital", "total_allocated")) ?? 0n), totalReserved: decimal(idOf(field(capacity, "reserved", "reserved_capital", "total_reserved")) ?? 0n), remaining: decimal(idOf(field(capacity, "available", "remaining_limit", "remaining")) ?? 0n), raw: jsonInput(capacity) };
        await this.db.pactCapacity.upsert({ where: { pactId: pact.id }, create: { pactId: pact.id, ...capacityData }, update: { ...capacityData, indexedAt: new Date() } });
        return true;
      }
      case "coverage": {
        const pactOnchainId = idOf(field(raw, "pact_id", "pactId"));
        if (pactOnchainId === undefined) return false;
        const pact = await this.db.pact.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(pactOnchainId) } }, select: { id: true } });
        if (!pact) return false;
        const coverageData = { pactId: pact.id, buyerAddress: addressOf(field(raw, "buyer", "buyer_address", "customer")), status: stringOf(field(raw, "status")), coverageLimit: decimal(idOf(field(raw, "coverage_limit", "limit")) ?? 0n), startAt: dateOf(field(raw, "start_ts", "start_at")), endAt: dateOf(field(raw, "end_ts", "end_at")), raw: jsonInput(raw) };
        await this.db.coverage.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, ...coverageData }, update: { ...coverageData, indexedAt: new Date() } });
        return true;
      }
      case "incident": {
        const serviceOnchainId = idOf(field(raw, "service_id", "serviceId"));
        if (serviceOnchainId === undefined) return false;
        const service = await this.db.service.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(serviceOnchainId) } }, select: { id: true } });
        if (!service) return false;
        const incident = await this.db.incident.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, serviceId: service.id, status: stringOf(field(raw, "status")), observedStart: decimal(idOf(field(raw, "observed_start")) ?? 0n), observedEnd: decimal(idOf(field(raw, "observed_end")) ?? 0n), reportBond: decimal(idOf(field(raw, "report_bond")) ?? 0n), challengeBond: decimal(idOf(field(raw, "challenge_bond")) ?? 0n), openClaims: decimal(idOf(field(raw, "open_claims")) ?? 0n) }, update: { serviceId: service.id, status: stringOf(field(raw, "status")), observedStart: decimal(idOf(field(raw, "observed_start")) ?? 0n), observedEnd: decimal(idOf(field(raw, "observed_end")) ?? 0n), reportBond: decimal(idOf(field(raw, "report_bond")) ?? 0n), challengeBond: decimal(idOf(field(raw, "challenge_bond")) ?? 0n), openClaims: decimal(idOf(field(raw, "open_claims")) ?? 0n), raw: jsonInput(raw), indexedAt: new Date() } });
        const resolution = recordOf(await this.rpcCall(() => this.contract.read("get_incident_resolution", [onchainId])));
        await this.db.incidentResolution.upsert({ where: { incidentId: incident.id }, create: { incidentId: incident.id, status: stringOf(field(resolution, "status")), factStatus: stringOf(field(resolution, "fact_status")), faultDomain: stringOf(field(resolution, "fault_domain")), scope: stringOf(field(resolution, "scope")), incidentStart: decimal(idOf(field(resolution, "incident_start")) ?? 0n), incidentEnd: decimal(idOf(field(resolution, "incident_end")) ?? 0n), duration: decimal(idOf(field(resolution, "duration_seconds")) ?? 0n), p95LatencyMs: decimal(idOf(field(resolution, "observed_p95_latency_ms")) ?? 0n), availabilityPpm: decimal(idOf(field(resolution, "observed_availability_ppm")) ?? 0n), errorRatePpm: decimal(idOf(field(resolution, "observed_error_rate_ppm")) ?? 0n), blockLag: decimal(idOf(field(resolution, "observed_block_lag")) ?? 0n), supportIds: jsonInput(field(resolution, "fact_support") ?? {}) , raw: jsonInput(resolution) }, update: { status: stringOf(field(resolution, "status")), factStatus: stringOf(field(resolution, "fact_status")), faultDomain: stringOf(field(resolution, "fault_domain")), scope: stringOf(field(resolution, "scope")), incidentStart: decimal(idOf(field(resolution, "incident_start")) ?? 0n), incidentEnd: decimal(idOf(field(resolution, "incident_end")) ?? 0n), duration: decimal(idOf(field(resolution, "duration_seconds")) ?? 0n), p95LatencyMs: decimal(idOf(field(resolution, "observed_p95_latency_ms")) ?? 0n), availabilityPpm: decimal(idOf(field(resolution, "observed_availability_ppm")) ?? 0n), errorRatePpm: decimal(idOf(field(resolution, "observed_error_rate_ppm")) ?? 0n), blockLag: decimal(idOf(field(resolution, "observed_block_lag")) ?? 0n), supportIds: jsonInput(field(resolution, "fact_support") ?? {}), raw: jsonInput(resolution), indexedAt: new Date() } });
        if (this.contract.schema.methods["get_challenge"]) {
          const challenge = recordOf(await this.rpcCall(() => this.contract.read("get_challenge", [onchainId])));
          if (Object.keys(challenge).length > 0 && (field(challenge, "exists") !== false)) {
            const challengeStatus = stringOf(field(challenge, "status")) ?? (field(challenge, "resolved") === true ? "RESOLVED" : "OPEN");
            await this.db.challenge.upsert({ where: { incidentId: incident.id }, create: { deploymentId, incidentId: incident.id, challenger: addressOf(field(challenge, "challenger", "challenger_address")), status: challengeStatus, challengeBond: decimal(idOf(field(challenge, "bond", "challenge_bond")) ?? 0n), raw: jsonInput(challenge) }, update: { challenger: addressOf(field(challenge, "challenger", "challenger_address")), status: challengeStatus, challengeBond: decimal(idOf(field(challenge, "bond", "challenge_bond")) ?? 0n), raw: jsonInput(challenge), indexedAt: new Date() } });
          }
        }
        return true;
      }
      case "evidence": {
        const incidentOnchainId = idOf(field(raw, "incident_id", "incidentId"));
        if (incidentOnchainId === undefined) return false;
        const incident = await this.db.incident.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(incidentOnchainId) } }, select: { id: true } });
        if (!incident) return false;
        await this.db.evidence.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, incidentId: incident.id, evidenceType: stringOf(field(raw, "evidence_type", "evidenceType")), evidenceUri: stringOf(field(raw, "uri", "evidence_uri")), contentHash: stringOf(field(raw, "content_hash", "contentHash")), description: stringOf(field(raw, "description")), reporter: addressOf(field(raw, "submitter", "reporter")), authoritative: field(raw, "provenance") === "AUTHORITATIVE", reporterAuthorized: field(raw, "reporter_authorized_at_submission") === true, fetchStatus: field(raw, "usable") === false ? "FAILED" : "FETCHED", hashStatus: field(raw, "usable") === false ? "FAILED" : "VALID", schemaStatus: field(raw, "provenance") === "AUTHORITATIVE" ? "VALID" : "NOT_REQUIRED", usable: field(raw, "usable") !== false, artifactSha256: stringOf(field(raw, "content_hash", "contentHash")) }, update: { incidentId: incident.id, evidenceType: stringOf(field(raw, "evidence_type", "evidenceType")), evidenceUri: stringOf(field(raw, "uri", "evidence_uri")), contentHash: stringOf(field(raw, "content_hash", "contentHash")), description: stringOf(field(raw, "description")), reporter: addressOf(field(raw, "submitter", "reporter")), authoritative: field(raw, "provenance") === "AUTHORITATIVE", reporterAuthorized: field(raw, "reporter_authorized_at_submission") === true, usable: field(raw, "usable") !== false, raw: jsonInput(raw), indexedAt: new Date() } });
        return true;
      }
      case "claim": {
        const coverageOnchainId = idOf(field(raw, "coverage_id", "coverageId"));
        const incidentOnchainId = idOf(field(raw, "incident_id", "incidentId"));
        if (coverageOnchainId === undefined || incidentOnchainId === undefined) return false;
        const [coverage, incident] = await Promise.all([this.db.coverage.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(coverageOnchainId) } }, select: { id: true } }), this.db.incident.findUnique({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(incidentOnchainId) } }, select: { id: true } })]);
        if (!coverage || !incident) return false;
        await this.db.claim.upsert({ where: { deploymentId_onchainId: { deploymentId, onchainId: decimal(onchainId) } }, create: { ...common, coverageId: coverage.id, incidentId: incident.id, claimant: addressOf(field(raw, "claimant", "buyer")), status: stringOf(field(raw, "status")), payout: decimal(idOf(field(raw, "payout", "settled_amount")) ?? 0n) }, update: { coverageId: coverage.id, incidentId: incident.id, claimant: addressOf(field(raw, "claimant", "buyer")), status: stringOf(field(raw, "status")), payout: decimal(idOf(field(raw, "payout", "settled_amount")) ?? 0n), raw: jsonInput(raw), indexedAt: new Date() } });
        return true;
      }
    }
  }

  async reconcile(): Promise<number> {
    const deploymentId = await this.ensureDeployment();
    const claims = await this.db.claim.findMany({ where: { deploymentId }, take: 1000 });
    let anomalies = 0;
    for (const claim of claims) {
      try {
        const chain = recordOf(await this.rpcCall(() => this.contract.getEntity("claim", BigInt(claim.onchainId.toString()))));
        const chainStatus = stringOf(field(chain, "status"));
        if (chainStatus && chainStatus !== claim.status) {
          anomalies += 1;
          await this.db.reconciliationRecord.create({ data: { entityKind: "claim", entityId: claim.onchainId, dbStatus: claim.status, chainStatus, action: "CHAIN_WINS", details: jsonInput({ claimId: claim.onchainId.toString() }) } });
          await this.db.claim.update({ where: { id: claim.id }, data: { status: chainStatus, raw: jsonInput(chain), indexedAt: new Date() } });
        }
      } catch (error) {
        this.log?.warn({ claimId: claim.onchainId.toString(), err: error instanceof Error ? error.message : String(error) }, "claim reconciliation read failed");
      }
    }
    return anomalies;
  }

  async run(pollMs: number, reconcileMs: number, signal: AbortSignal): Promise<void> {
    if (this.running) throw new Error("indexer already running");
    this.running = true;
    let nextReconcile = 0;
    try {
      while (!signal.aborted) {
        try { await this.syncOnce(); } catch (error) { this.log?.error({ err: error }, "indexer cycle failed"); }
        if (Date.now() >= nextReconcile) {
          try { await this.reconcile(); } catch (error) { this.log?.error({ err: error }, "reconciliation cycle failed"); }
          nextReconcile = Date.now() + reconcileMs;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollMs);
          signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    } finally { this.running = false; }
  }
}
