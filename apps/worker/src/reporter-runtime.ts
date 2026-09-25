import type { PrismaClient } from "@prisma/client";
import { createLiveAdapter, createReporterWriter, mapTransactionRecord, ReporterConfigurationError, TransactionTracker, type FaultPactContractAdapter, type RpcTransport } from "@faultpact/contract";
import { decimal } from "@faultpact/db";
import { assertArtifactSize, buildArtifactUrl, buildProbeEvidenceForIncident, persistImmutableArtifact, type EvidenceType, type PriorAttempt, type ProbeEvidenceV1 } from "@faultpact/monitoring";
import { jsonSafe, type AppEnv } from "@faultpact/shared";
import type { ReporterArtifactPort, ReporterAttemptStore, ReporterAttemptUpdate, ReporterChainPort, ReporterRunDeps, ReporterTrackerPort, ReporterWritePort } from "./reporter-submit.js";

export type ReporterRuntimeOptions = {
  env: AppEnv;
  db: PrismaClient;
  adapter?: FaultPactContractAdapter;
  transport?: RpcTransport;
  verifyContractSource?: boolean;
  log?: (message: string, detail?: Record<string, unknown>) => void;
  fetchArtifactBytes?: (url: string) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
  trackOptions?: { maxWaitMs?: number; initialPollMs?: number; maxPollMs?: number };
  finalizationSubsystem?: string;
};

export type ReporterRuntimeHandle = { deps: ReporterRunDeps; adapter: FaultPactContractAdapter; close: () => Promise<void> };

function jsonInput(value: unknown) {
  return jsonSafe(value) as never;
}

const UNRESOLVED_STATES = new Set(["SUBMITTED", "PENDING", "FINALIZING", "RECONCILING"]);

/** Streams the public artifact and returns the exact response bytes. Never parses and re-serializes. */
export async function fetchArtifactBytes(url: string, options: { maxBytes: number; timeoutMs?: number }): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
  const headers: Record<string, string> = {};
  for (const [key, value] of response.headers) headers[key.toLowerCase()] = value;
  if (!response.ok) return { status: response.status, headers, body: Buffer.alloc(0) };
  const declared = Number(headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > options.maxBytes) throw new Error(`public artifact declares ${declared} bytes, above the ${options.maxBytes} byte limit`);
  return { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) };
}

export function createReporterChainPort(adapter: FaultPactContractAdapter): ReporterChainPort {
  return {
    chainIdFromRpc: async () => await adapter.chainIdFromRpc({ request: { subsystem: "reporter_preflight" } }),
    verifyFrozenContract: async () => {
      const verification = await adapter.verifyDeployment(undefined, { checkSchema: false });
      return { chainId: verification.chainId, sourceSha256: verification.sourceSha256, sourceMatches: verification.sourceMatches, address: verification.address };
    },
    isAuthorizedReporter: async (address: string) => await adapter.isAuthorizedReporter(address, { subsystem: "reporter_preflight" }),
    getIncident: async (incidentId: bigint) => {
      const record = await adapter.getIncident(incidentId, { subsystem: "reporter_evidence" });
      return { status: String(record.status ?? "UNKNOWN"), evidenceDeadline: String(record.evidence_deadline ?? "0"), serviceId: String(record.service_id ?? "0"), summary: String(record.summary ?? "") };
    },
    incidentEvidenceIds: async (incidentId: bigint) => await adapter.getIncidentEvidenceIds(incidentId, { subsystem: "reporter_evidence" }),
    readEvidence: async (evidenceId: bigint) => await adapter.getEvidence(evidenceId, { subsystem: "reporter_evidence" }),
  };
}

export function createReporterTracker(transport: RpcTransport, options: { maxWaitMs?: number; initialPollMs?: number; maxPollMs?: number; subsystem?: string } = {}): ReporterTrackerPort {
  return {
    waitForFinalization: async (hash: string) => await new TransactionTracker({
      fetchTransaction: async (txHash) => mapTransactionRecord(await transport.request("eth_getTransactionByHash", [txHash], { subsystem: options.subsystem ?? "reporter_finalization" }), txHash, new Date().toISOString()),
      ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
      ...(options.initialPollMs === undefined ? {} : { initialPollMs: options.initialPollMs }),
      ...(options.maxPollMs === undefined ? {} : { maxPollMs: options.maxPollMs }),
    }).waitForFinalization(hash),
  };
}

/**
 * Canonical immutable artifact repository for reporter submissions. Reuses the
 * existing probe evidence schema, byte-exact storage and SHA-256 keying, so a
 * retry resolves the same immutable artifact instead of generating a new one.
 */
export function createPrismaArtifactPort(db: PrismaClient, input: { publicBaseUrl: string; maxBytes: number }): ReporterArtifactPort {
  return {
    resolve: async (request) => {
      if (request.requestedSha256) {
        const existing = await db.evidenceArtifact.findUnique({ where: { sha256: request.requestedSha256 } });
        if (!existing) throw new Error(`evidence artifact ${request.requestedSha256} referenced by a prior attempt no longer exists`);
        return { sha256: existing.sha256, url: buildArtifactUrl(input.publicBaseUrl, existing.sha256), sizeBytes: existing.sizeBytes, reused: true };
      }
      const target = await db.monitorTarget.findFirst({ where: { region: request.region }, orderBy: { id: "asc" } });
      const aggregate = target ? await db.metricAggregate.findFirst({ where: { targetId: target.id, windowSeconds: 300 }, orderBy: { windowEnd: "desc" } }) : null;
      const value: ProbeEvidenceV1 = buildProbeEvidenceForIncident({
        serviceId: request.serviceId,
        region: request.region,
        observedStart: request.observedStart,
        observedEnd: request.observedEnd,
        probeId: request.probeId,
        availabilityPpm: aggregate ? Number(aggregate.availabilityPpm.toString()) : 0,
        errorRatePpm: aggregate ? Number(aggregate.errorRatePpm.toString()) : 0,
        incidentConfirmed: true,
        faultDomain: "PROVIDER",
        sequence: request.observedEnd,
      });
      const artifact = await persistImmutableArtifact({
        findBySha256: async (sha256) => {
          const row = await db.evidenceArtifact.findUnique({ where: { sha256 } });
          return row ? { sha256: row.sha256, bytes: row.bytes } : null;
        },
        create: async (created) => {
          assertArtifactSize(created, input.maxBytes);
          await db.evidenceArtifact.create({
            data: {
              sha256: created.sha256,
              contentType: created.contentType,
              sizeBytes: created.sizeBytes,
              schemaVersion: created.schemaVersion,
              serviceId: decimal(request.serviceId),
              region: request.region,
              windowStart: new Date(request.observedStart * 1000),
              windowEnd: new Date(request.observedEnd * 1000),
              bytes: created.bytes as unknown as Uint8Array<ArrayBuffer>,
              metadata: jsonInput({ targetId: target?.id ?? null, publicUrl: buildArtifactUrl(input.publicBaseUrl, created.sha256), incidentId: request.incidentId.toString(), probeId: request.probeId, source: "reporter_evidence_worker" }),
            },
          });
        },
      }, value, { targetId: target?.id ?? null, region: request.region, incidentId: request.incidentId.toString() });
      assertArtifactSize(artifact, input.maxBytes);
      return { sha256: artifact.sha256, url: buildArtifactUrl(input.publicBaseUrl, artifact.sha256), sizeBytes: artifact.sizeBytes, reused: false };
    },
  };
}

/**
 * Retry-safe persistence for reporter writes. One row per artifact and contract
 * method is advanced through the transaction lifecycle; a new attempt row is
 * only created after the previous attempt reached a decided state.
 */
export function createPrismaAttemptStore(db: PrismaClient): ReporterAttemptStore {
  return {
    list: async (input) => {
      const rows = await db.evidenceSubmissionAttempt.findMany({
        where: { reporter: input.reporter, ...(input.sha256 ? { artifactSha256: input.sha256 } : { incidentId: decimal(input.incidentId) }) },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return rows.map((row): PriorAttempt => ({
        method: row.method ?? "",
        status: row.status,
        txHash: row.txHash,
        evidenceId: row.evidenceId ? row.evidenceId.toString() : null,
        artifactUrl: row.artifactUrl,
        sha256: row.artifactSha256,
        reporter: row.reporter,
        failureCategory: row.failureCategory,
        finalizedAt: row.finalizedAt,
      }));
    },
    save: async (record: ReporterAttemptUpdate) => {
      const artifact = await db.evidenceArtifact.findUnique({ where: { sha256: record.sha256 }, select: { id: true } });
      if (!artifact) throw new Error(`evidence artifact ${record.sha256} must be persisted before a submission attempt is recorded`);
      const data = {
        incidentId: decimal(record.incidentId),
        reporter: record.reporter,
        txHash: record.txHash ?? null,
        status: record.status,
        method: record.method,
        artifactUrl: record.artifactUrl,
        artifactSha256: record.sha256,
        evidenceId: record.evidenceId ? decimal(record.evidenceId) : null,
        txState: record.txState ?? null,
        finalizedAt: record.finalizedAt ?? null,
        failureCategory: record.failureCategory ?? null,
        error: record.error ?? null,
      };
      const previous = await db.evidenceSubmissionAttempt.findFirst({ where: { artifactId: artifact.id, method: record.method }, orderBy: { attemptNo: "desc" } });
      if (!previous) {
        await db.evidenceSubmissionAttempt.create({ data: { ...data, artifactId: artifact.id, attemptNo: 1, targetId: null, status: record.status === "SUBMITTED" ? "FINALIZING" : record.status } });
        return;
      }
      if (record.status === "SUBMITTED" && !UNRESOLVED_STATES.has(previous.status)) {
        await db.evidenceSubmissionAttempt.create({ data: { ...data, artifactId: artifact.id, attemptNo: previous.attemptNo + 1, targetId: null, status: "FINALIZING" } });
        return;
      }
      await db.evidenceSubmissionAttempt.update({ where: { id: previous.id }, data: { ...data, status: record.status === "SUBMITTED" ? "FINALIZING" : record.status } });
    },
  };
}

/** Builds every production dependency for the signer-backed evidence path. */
export async function createReporterRuntime(options: ReporterRuntimeOptions): Promise<ReporterRuntimeHandle> {
  const { env, db } = options;
  const adapter = options.adapter ?? await createLiveAdapter({
    minIntervalMs: env.GENLAYER_RPC_MIN_INTERVAL_MS,
    dailyBudget: env.GENLAYER_RPC_DAILY_BUDGET,
    ...(env.GENLAYER_RPC_BUDGET_STATE_FILE ? { budgetStateFile: env.GENLAYER_RPC_BUDGET_STATE_FILE } : {}),
  });
  const transport = options.transport ?? adapter.transport;
  if (!env.REPORTER_PRIVATE_KEY) throw new ReporterConfigurationError("REPORTER_SUBMISSION_DISABLED", "REPORTER SUBMISSION DISABLED: REPORTER_PRIVATE_KEY is not configured, the worker stays MONITOR-ONLY");
  const writer = await createReporterWriter({ privateKey: env.REPORTER_PRIVATE_KEY, contractAddress: adapter.address, transport, chainId: env.GENLAYER_CHAIN_ID, rpcUrl: env.GENLAYER_RPC_URL });
  if (env.REPORTER_EXPECTED_ADDRESS && env.REPORTER_EXPECTED_ADDRESS.toLowerCase() !== writer.address.toLowerCase()) {
    await writer.close();
    throw new ReporterConfigurationError("REPORTER_ADDRESS_MISMATCH", `REPORTER_PRIVATE_KEY derives ${writer.address}, which is not the configured REPORTER_EXPECTED_ADDRESS; no transaction was signed`);
  }
  const writePort: ReporterWritePort = { address: writer.address, send: async (request) => await writer.send(request) };
  const verifyContractSource = options.verifyContractSource ?? true;
  const deps: ReporterRunDeps = {
    chain: createReporterChainPort(adapter),
    writer: writePort,
    tracker: createReporterTracker(transport, { ...(options.trackOptions ?? {}), ...(options.finalizationSubsystem ? { subsystem: options.finalizationSubsystem } : {}) }),
    artifacts: createPrismaArtifactPort(db, { publicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL, maxBytes: env.EVIDENCE_MAX_BYTES }),
    attempts: createPrismaAttemptStore(db),
    fetchArtifactBytes: options.fetchArtifactBytes ?? ((url: string) => fetchArtifactBytes(url, { maxBytes: env.EVIDENCE_MAX_BYTES })),
    runtime: {
      chainId: env.GENLAYER_CHAIN_ID,
      contractAddress: adapter.address,
      frozenSourceSha256: env.FAULTPACT_SOURCE_SHA256,
      evidencePublicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL,
      region: env.PROBE_REGION,
      evidenceMaxBytes: env.EVIDENCE_MAX_BYTES,
      verifyContractSource,
    },
    options: { incidentId: 0n, summary: "", description: "", submitEvidenceType: "THIRD_PARTY_MONITOR" as EvidenceType },
    ...(options.log ? { log: options.log } : {}),
  };
  return { deps, adapter, close: async () => { await writer.close(); } };
}
