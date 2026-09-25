import type { PrismaClient, Prisma } from "@prisma/client";
import type { Logger } from "pino";
import { decimal } from "@faultpact/db";
import { aggregateSamples, assertArtifactSize, persistImmutableArtifact, nextCandidateState, probeRpc, type Aggregate, type RpcProbeResult } from "@faultpact/monitoring";
import { isFrozenRpcUrl, jsonSafe, sleep } from "@faultpact/shared";

function jsonInput(value: unknown): Prisma.InputJsonValue { return jsonSafe(value) as Prisma.InputJsonValue; }

export class MonitoringWorker {
  private running = false;
  private cooldownLogged = false;
  private schedulerErrorLogged = false;
  constructor(private readonly db: PrismaClient, private readonly options: { region: string; mode: string; timeoutMs: number; maxResponseBytes: number; evidenceMaxBytes?: number; rawRetentionSeconds?: number; referenceUrl?: string; evidencePublicBaseUrl?: string; reporterMode?: string; logger?: Logger; workerId?: string; genlayerProbeIntervalMs?: number; rpcCall?: (method: string, params?: readonly unknown[], options?: { subsystem?: string }) => Promise<unknown>; rpcCooldownUntil?: () => number | Promise<number> }) {}

  private async currentCooldown(): Promise<number> {
    if (!this.options.rpcCooldownUntil) return 0;
    try {
      const value = await this.options.rpcCooldownUntil();
      this.schedulerErrorLogged = false;
      return value;
    } catch (error) {
      if (!this.schedulerErrorLogged) this.options.logger?.error({ err: error }, "RPC scheduler state unreadable; monitoring suspended fail-safe");
      this.schedulerErrorLogged = true;
      return Date.now() + 60_000;
    }
  }

  async runOnce(): Promise<number> {
    const retentionSeconds = this.options.rawRetentionSeconds ?? 604800;
    await this.db.probeSample.deleteMany({ where: { region: this.options.region, observedAt: { lt: new Date(Date.now() - retentionSeconds * 1000) } } });
    const targets = await this.db.monitorTarget.findMany({ where: { enabled: true, region: this.options.region }, take: 1000, orderBy: { id: "asc" } });
    let successes = 0;
    let suppressed = 0;
    let schedulerErrors = 0;
    let latestProbeAt: Date | undefined;
    const referenceUsesGenLayer = this.options.referenceUrl ? isFrozenRpcUrl(this.options.referenceUrl) : false;
    let schedulerRelevant = referenceUsesGenLayer;
    for (const target of targets) {
      const previous = await this.db.probeSample.findFirst({ where: { targetId: target.id }, orderBy: { observedAt: "desc" } });
      if (previous?.observedAt && (!latestProbeAt || previous.observedAt > latestProbeAt)) latestProbeAt = previous.observedAt;
      const reference = previous?.referenceBlock ? BigInt(previous.referenceBlock.toString()) : undefined;
      const targetUsesGenLayer = isFrozenRpcUrl(target.endpointUrl);
      const usesGenLayer = targetUsesGenLayer || referenceUsesGenLayer;
      schedulerRelevant ||= usesGenLayer;
      if (usesGenLayer && !this.options.rpcCall) {
        schedulerErrors += 1;
        suppressed += 1;
        this.options.logger?.error({ targetId: target.id, endpointUrl: target.endpointUrl }, "Studio RPC target requires the shared scheduler callback; probe suppressed");
        continue;
      }
      const probeInterval = targetUsesGenLayer ? Math.max(target.intervalMs, this.options.genlayerProbeIntervalMs ?? 1_800_000) : target.intervalMs;
      if (previous?.observedAt && Date.now() - previous.observedAt.getTime() < probeInterval) { suppressed += 1; continue; }
      const cooldownUntil = usesGenLayer ? await this.currentCooldown() : 0;
      if (cooldownUntil > Date.now()) { suppressed += 1; continue; }
      const result = await probeRpc({
        probeId: `${target.id}-${Date.now()}`,
        url: target.endpointUrl,
        expectedChainId: target.expectedChainId,
        referenceUrl: this.options.referenceUrl,
        timeoutMs: Math.min(this.options.timeoutMs, target.timeoutMs),
        maxResponseBytes: this.options.maxResponseBytes,
        staleHead: reference === undefined ? undefined : { previousTarget: previous?.targetBlock ? BigInt(previous.targetBlock.toString()) : undefined, previousReference: reference, minimumReferenceAdvance: 1n },
        ...(targetUsesGenLayer && this.options.rpcCall ? { rpcCall: this.options.rpcCall } : {}),
        ...(referenceUsesGenLayer && this.options.rpcCall ? { referenceRpcCall: this.options.rpcCall } : {}),
      });
      latestProbeAt = result.observedAt;
      if (result.success) successes += 1;
      await this.storeSample(target.id, result);
      const aggregate = await this.aggregateTarget(target.id, 300);
      const evidenceMode = target.evidenceMode === "observe" ? this.options.mode : target.evidenceMode;
      if (aggregate && evidenceMode !== "observe" && target.serviceId !== null) {
        const service = await this.db.service.findUnique({ where: { id: target.serviceId }, select: { onchainId: true } });
        if (service) {
          const serviceId = Number(service.onchainId.toString());
          if (!Number.isSafeInteger(serviceId) || serviceId < 0) throw new Error("onchain service ID cannot be represented by probe schema");
          await this.storeEvidenceArtifact(serviceId, aggregate, result, target.id);
        }
      }
      const schedulerSuppressedFailure = usesGenLayer && result.errorCode === "HTTP_429";
      if (target.serviceId !== null && !schedulerSuppressedFailure) await this.updateCandidate(target.id, target.serviceId, result);
    }
    const cooldownUntil = schedulerRelevant ? await this.currentCooldown() : 0;
    const degraded = schedulerErrors > 0 || cooldownUntil > Date.now();
    if (degraded && !this.cooldownLogged) {
      if (cooldownUntil > Date.now()) this.options.logger?.warn({ cooldownUntil: new Date(cooldownUntil).toISOString(), suppressed }, "Studio RPC entered cooldown; monitoring probes suspended");
      this.cooldownLogged = true;
    }
    if (!degraded && this.cooldownLogged) { this.options.logger?.info("Studio RPC cooldown expired; monitoring scheduling resumed"); this.cooldownLogged = false; }
    const heartbeatDetails = { targetCount: targets.length, successes, suppressed, schedulerErrors, cooldownUntil: cooldownUntil || null, reporterMode: this.options.reporterMode ?? "MONITOR_ONLY" };
    await this.db.workerHeartbeat.upsert({ where: { workerId: this.options.workerId ?? `monitor-${this.options.region}` }, create: { workerId: this.options.workerId ?? `monitor-${this.options.region}`, role: "monitor", region: this.options.region, mode: this.options.mode, lastProbeAt: latestProbeAt ?? null, status: degraded ? "DEGRADED" : "HEALTHY", details: jsonInput(heartbeatDetails) }, update: { lastProbeAt: latestProbeAt ?? null, status: degraded ? "DEGRADED" : "HEALTHY", details: jsonInput(heartbeatDetails) } });
    return targets.length;
  }

  private async storeSample(targetId: number, result: RpcProbeResult): Promise<void> {
    await this.db.probeSample.create({ data: { targetId, probeId: result.probeId, region: this.options.region, observedAt: result.observedAt, method: "rpc_baseline", success: result.success, latencyMs: result.latencyMs === undefined ? null : Math.ceil(result.latencyMs), httpStatus: result.httpStatus ?? null, expectedChainId: result.expectedChainId, observedChainId: result.observedChainId ?? null, targetBlock: result.targetBlock === undefined ? null : decimal(result.targetBlock), referenceBlock: result.referenceBlock === undefined ? null : decimal(result.referenceBlock), blockLag: result.blockLag === undefined ? null : decimal(result.blockLag), blockLagKnown: result.blockLagKnown, stale: result.stale, errorCode: result.errorCode ?? null, errorMessage: result.errorMessage ?? null, raw: result.raw === undefined ? undefined : jsonInput(result.raw) } });
  }

  private async aggregateTarget(targetId: number, windowSeconds: number): Promise<Aggregate | undefined> {
    const since = new Date(Date.now() - windowSeconds * 1000);
    const samples = await this.db.probeSample.findMany({ where: { targetId, observedAt: { gte: since } }, orderBy: { observedAt: "asc" }, take: 1000 });
    if (!samples.length) return undefined;
    const aggregate = aggregateSamples(samples.map((sample) => ({ success: sample.success, latencyMs: sample.latencyMs ?? undefined, targetBlock: sample.targetBlock ? BigInt(sample.targetBlock.toString()) : undefined, referenceBlock: sample.referenceBlock ? BigInt(sample.referenceBlock.toString()) : undefined, blockLag: sample.blockLag ? BigInt(sample.blockLag.toString()) : undefined, blockLagKnown: sample.blockLagKnown, stale: sample.stale })));
    const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
    const windowEnd = new Date(windowStart.getTime() + windowSeconds * 1000);
    await this.db.metricAggregate.upsert({ where: { targetId_windowSeconds_windowStart: { targetId, windowSeconds, windowStart } }, create: { targetId, windowSeconds, windowStart, windowEnd, sampleCount: aggregate.sampleCount, successCount: aggregate.successCount, failureCount: aggregate.failureCount, availabilityPpm: decimal(aggregate.availabilityPpm), errorRatePpm: decimal(aggregate.errorRatePpm), p50LatencyMs: aggregate.p50LatencyMs ?? null, p95LatencyMs: aggregate.p95LatencyMs ?? null, maxLatencyMs: aggregate.maxLatencyMs ?? null, latestBlock: aggregate.latestBlock === undefined ? null : decimal(aggregate.latestBlock), referenceBlock: aggregate.referenceBlock === undefined ? null : decimal(aggregate.referenceBlock), blockLagKnown: aggregate.blockLagKnown, stale: aggregate.stale, inputs: jsonInput(samples.map((sample) => sample.probeId)) }, update: { windowEnd, sampleCount: aggregate.sampleCount, successCount: aggregate.successCount, failureCount: aggregate.failureCount, availabilityPpm: decimal(aggregate.availabilityPpm), errorRatePpm: decimal(aggregate.errorRatePpm), p50LatencyMs: aggregate.p50LatencyMs ?? null, p95LatencyMs: aggregate.p95LatencyMs ?? null, maxLatencyMs: aggregate.maxLatencyMs ?? null, latestBlock: aggregate.latestBlock === undefined ? null : decimal(aggregate.latestBlock), referenceBlock: aggregate.referenceBlock === undefined ? null : decimal(aggregate.referenceBlock), blockLagKnown: aggregate.blockLagKnown, stale: aggregate.stale, inputs: jsonInput(samples.map((sample) => sample.probeId)) } });
    return aggregate;
  }

  private async storeEvidenceArtifact(serviceId: number, aggregate: Aggregate, result: RpcProbeResult, targetId: number): Promise<void> {
    const observedEnd = Math.floor(result.observedAt.getTime() / 1000);
    const value = { schema: "faultpact-probe-v1" as const, service_id: serviceId, region: this.options.region.toLowerCase(), observed_start: observedEnd - 300, observed_end: observedEnd, availability_ppm: Number(aggregate.availabilityPpm), p95_latency_ms: aggregate.p95LatencyMs ?? null, error_rate_ppm: Number(aggregate.errorRatePpm), block_lag: aggregate.blockLagKnown && aggregate.latestBlock !== undefined && aggregate.referenceBlock !== undefined ? Number(aggregate.referenceBlock > aggregate.latestBlock ? aggregate.referenceBlock - aggregate.latestBlock : 0n) : null, chain_level_failure: result.errorCode === "WRONG_CHAIN", fault_domain: "UNKNOWN" as const, incident_confirmed: false, probe_id: result.probeId, sequence: Math.floor(result.observedAt.getTime() / 1000) };
    const artifact = await persistImmutableArtifact({
      findBySha256: async (sha256) => { const existing = await this.db.evidenceArtifact.findUnique({ where: { sha256 } }); return existing ? { sha256: existing.sha256, bytes: existing.bytes } : null; },
      create: async (artifact) => { assertArtifactSize(artifact, this.options.evidenceMaxBytes ?? 65536); await this.db.evidenceArtifact.create({ data: { sha256: artifact.sha256, contentType: artifact.contentType, sizeBytes: artifact.sizeBytes, schemaVersion: artifact.schemaVersion, serviceId: decimal(serviceId), region: this.options.region, windowStart: new Date((observedEnd - 300) * 1000), windowEnd: new Date(observedEnd * 1000), bytes: artifact.bytes as unknown as Uint8Array<ArrayBuffer>, metadata: jsonInput({ targetId, publicUrl: this.options.evidencePublicBaseUrl ? `${this.options.evidencePublicBaseUrl.replace(/\/$/, "")}/${artifact.sha256}.json` : null, reporterMode: this.options.mode }) } }); },
    }, value, { targetId, region: this.options.region });
    assertArtifactSize(artifact, this.options.evidenceMaxBytes ?? 65536);
  }

  private async updateCandidate(targetId: number, serviceId: number, result: RpcProbeResult): Promise<void> {
    const candidate = await this.db.incidentCandidate.findFirst({ where: { targetId }, orderBy: { updatedAt: "desc" } });
    const failures = result.success ? 0 : (candidate?.consecutiveFailures ?? 0) + 1;
    const recoveries = result.success ? (candidate?.state === "ACTIVE" || candidate?.state === "RECOVERING" ? 1 : 0) : 0;
    const state = nextCandidateState({ state: (candidate?.state as Parameters<typeof nextCandidateState>[0]["state"]) ?? "HEALTHY", failures, recoveries, requiredFailures: 3, requiredRecoveries: 2, evidenceReady: false });
    const data = { targetId, serviceId, state, reason: result.errorCode ?? (result.success ? null : "RPC_FAILURE"), firstObservedAt: candidate?.firstObservedAt ?? result.observedAt, lastObservedAt: result.observedAt, consecutiveFailures: failures, signal: jsonInput({ success: result.success, errorCode: result.errorCode, observedChainId: result.observedChainId, targetBlock: result.targetBlock?.toString() ?? null }) };
    if (candidate) await this.db.incidentCandidate.update({ where: { id: candidate.id }, data });
    else await this.db.incidentCandidate.create({ data });
  }

  async run(intervalMs: number, signal: AbortSignal): Promise<void> {
    if (this.running) throw new Error("monitoring worker already running");
    this.running = true;
    try {
      while (!signal.aborted) {
        try { await this.runOnce(); } catch (error) { this.options.logger?.error({ err: error }, "monitoring cycle failed"); }
        try { await sleep(intervalMs, signal); }
        catch { if (!signal.aborted) throw new Error("monitoring wait failed"); }
      }
    } finally { this.running = false; }
  }
}
