import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { FaultPactContractAdapter, FROZEN_CHAIN_ID, FROZEN_CONTRACT_ADDRESS, FROZEN_RPC_URL } from "@faultpact/contract";
import { decimal, listIndexed, publicRow } from "@faultpact/db";
import { normalizeHash256, parsePage } from "@faultpact/shared";
import { resolveSafeEndpoint } from "@faultpact/monitoring";

export type ApiDependencies = {
  db: PrismaClient;
  contract?: FaultPactContractAdapter;
  deploymentId: number;
  deploymentVerified?: boolean;
  reconcileMaxAgeMs?: number;
  adminToken?: string;
  evidencePublicBaseUrl: string;
  probeHttpAllowed: boolean;
  logger?: Logger;
};

type Params = Record<string, string>;

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

class ApiInputError extends Error {}

function routeFailure(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown, logger?: Logger) {
  if (error instanceof ApiInputError) return reply.code(400).send({ error: error.message });
  logger?.error({ err: error }, "API operation failed");
  return reply.code(503).send({ error: "Temporarily unavailable" });
}

function cursorIsFresh(cursor: { status?: string; lastSuccessAt?: Date | null } | null, maxAgeMs: number): boolean {
  return cursor?.status === "HEALTHY" && cursor.lastSuccessAt instanceof Date && Date.now() - cursor.lastSuccessAt.getTime() <= maxAgeMs;
}

function queryText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 128) throw new ApiInputError(`${field} must be at most 128 characters`);
  return value;
}

function responseData(data: unknown, extra: Record<string, unknown> = {}) { return { data: publicRow(data), ...extra }; }

function onchainId(params: Params): ReturnType<typeof decimal> {
  const value = params.id;
  if (!value || !/^\d+$/.test(value)) throw new ApiInputError("id must be an unsigned decimal string");
  return decimal(value);
}

function pageQuery(query: Record<string, unknown>) {
  try { return parsePage(query); }
  catch (error) { throw new ApiInputError(errorMessage(error)); }
}

export async function buildApp(deps: ApiDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 262144, requestTimeout: 15000 }) as FastifyInstance;
  await app.register(swagger, {
    openapi: {
      info: { title: "FaultPact API", version: "1.0.0", description: "Read API and controlled monitoring operations for the frozen FaultPact deployment." },
      servers: [{ url: "/api/v1" }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.get("/api/v1/health", async (_request, reply) => {
    try {
      await deps.db.$queryRaw`SELECT 1`;
      return responseData({ process: "ok", database: "ok", contract: "configured" });
    } catch (error) {
      deps.logger?.error({ err: error }, "API health database check failed");
      return reply.code(503).send(responseData({ process: "ok", database: "error" }, { error: "Database unavailable" }));
    }
  });

  app.get("/api/v1/ready", async (_request, reply) => {
    const checks: Record<string, string> = {};
    let databaseAvailable = false;
    try { await deps.db.$queryRaw`SELECT 1`; checks.database = "ok"; databaseAvailable = true; }
    catch (error) { checks.database = "error"; deps.logger?.warn({ err: error }, "Readiness database check failed"); }
    checks.deployment = deps.deploymentVerified ? "verified" : "unverified";
    if (deps.contract) {
      try {
        const cooldownUntil = await deps.contract.refreshRpcCooldown();
        checks.externalRpc = cooldownUntil > Date.now()
          ? "degraded"
          : (await deps.contract.chainIdFromRpc({ maxAgeMs: 30 * 60_000, request: { subsystem: "api_health" } })) === FROZEN_CHAIN_ID ? "ok" : "wrong_chain";
      } catch { checks.externalRpc = "degraded"; }
    } else checks.externalRpc = "unavailable";
    let cursor = null;
    let reconciliationCursor = null;
    if (databaseAvailable) {
      try {
        [cursor, reconciliationCursor] = await Promise.all([
          deps.db.syncCursor.findUnique({ where: { deploymentId_entityKind: { deploymentId: deps.deploymentId, entityKind: "all" } } }),
          deps.db.syncCursor.findUnique({ where: { deploymentId_entityKind: { deploymentId: deps.deploymentId, entityKind: "reconciliation" } } }),
        ]);
      } catch (error) { deps.logger?.warn({ err: error }, "Readiness indexer check failed"); }
    }
    const bootstrapFresh = cursorIsFresh(cursor, 10 * 60_000);
    const reconciliationFresh = cursorIsFresh(reconciliationCursor, deps.reconcileMaxAgeMs ?? 60 * 60_000);
    checks.indexer = bootstrapFresh && reconciliationFresh ? "ok" : "degraded";
    if (cursor?.lastError && /\b429\b|cooldown|rate[\s-]?limit|daily budget/i.test(cursor.lastError)) checks.externalRpc = "degraded";
    if (reconciliationCursor?.lastError && /\b429\b|cooldown|rate[\s-]?limit|daily budget/i.test(reconciliationCursor.lastError)) checks.externalRpc = "degraded";
    const ready = databaseAvailable && deps.deploymentVerified === true;
    const degraded = checks.externalRpc !== "ok" || checks.indexer !== "ok";
    return reply.code(ready ? 200 : 503).send(responseData({ ready, degraded, checks, deployment: { chainId: FROZEN_CHAIN_ID, contractAddress: FROZEN_CONTRACT_ADDRESS, rpc: FROZEN_RPC_URL }, indexedAt: cursor?.lastSuccessAt ?? null, reconciliationAt: reconciliationCursor?.lastSuccessAt ?? null }));
  });

  app.get("/api/v1/status", async (_request, reply) => {
    const [heartbeat, cursors, artifacts] = await Promise.all([
      deps.db.workerHeartbeat.findMany({ orderBy: { updatedAt: "desc" }, take: 20 }),
      deps.db.syncCursor.findMany({ where: { deploymentId: deps.deploymentId }, orderBy: { entityKind: "asc" } }),
      deps.db.evidenceArtifact.count(),
    ]);
    return reply.send(responseData({ heartbeats: heartbeat, cursors, evidenceArtifacts: artifacts }));
  });

  app.get("/api/v1/network", async () => responseData({ network: "GenLayer Studio Development Preview", chainId: FROZEN_CHAIN_ID, rpc: FROZEN_RPC_URL, contractAddress: FROZEN_CONTRACT_ADDRESS }));
  app.get("/api/v1/credits/:address", async (request, reply) => {
    const address = (request.params as Params).address ?? "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return reply.code(400).send({ error: "address must be a 20-byte EVM address" });
    if (!deps.contract) return reply.code(503).send({ error: "Claimable credit is temporarily unavailable" });
    try {
      const claimableCredit = await deps.contract.read("get_claimable_balance", [address], { subsystem: "api_read" });
      return reply.send(responseData({ address: address.toLowerCase(), claimableCredit }, { source: "frozen_contract_view" }));
    } catch (error) { return routeFailure(reply, error, deps.logger); }
  });
  app.get("/api/v1/protocol/config", async () => {
    const snapshot = await deps.db.protocolSnapshot.findUnique({ where: { deploymentId: deps.deploymentId } });
    const config = snapshot?.raw ?? (deps.contract ? await deps.contract.getProtocolConfig({ subsystem: "api_read" }) : null);
    return responseData(config, { indexedAt: snapshot?.capturedAt ?? null, source: snapshot ? "indexed_contract_view" : "live_contract_view" });
  });
  app.get("/api/v1/stats", async () => {
    const [providers, services, pacts, coverages, incidents, claims, evidence, cursor] = await Promise.all([
      deps.db.provider.count({ where: { deploymentId: deps.deploymentId } }),
      deps.db.service.count({ where: { deploymentId: deps.deploymentId } }),
      deps.db.pact.count({ where: { deploymentId: deps.deploymentId } }),
      deps.db.coverage.count({ where: { deploymentId: deps.deploymentId } }),
      deps.db.incident.count({ where: { deploymentId: deps.deploymentId } }),
      deps.db.claim.count({ where: { deploymentId: deps.deploymentId } }),
      deps.db.evidence.count({ where: { deploymentId: deps.deploymentId } }),
      deps.db.syncCursor.findUnique({ where: { deploymentId_entityKind: { deploymentId: deps.deploymentId, entityKind: "all" } } }),
    ]);
    return responseData({ providers, services, pacts, coverages, incidents, claims, evidence, source: "indexed_contract_state" }, { indexedAt: cursor?.lastSuccessAt ?? null });
  });

  app.get("/api/v1/monitoring", async (_request, reply) => {
    try {
      const targets = await deps.db.monitorTarget.findMany({
        where: { enabled: true },
        orderBy: { name: "asc" },
        take: 100,
        include: {
          samples: { orderBy: { observedAt: "desc" }, take: 1 },
          aggregates: { where: { windowSeconds: 300 }, orderBy: { windowEnd: "desc" }, take: 1 },
          candidates: { orderBy: { updatedAt: "desc" }, take: 1 },
        },
      });
      const rows = targets.map((target) => {
        const sample = target.samples[0];
        const aggregate = target.aggregates[0];
        const candidate = target.candidates[0];
        const latestBlock = aggregate?.latestBlock?.toString();
        const referenceBlock = aggregate?.referenceBlock?.toString();
        const blockLag = aggregate?.blockLagKnown && latestBlock && referenceBlock
          ? (BigInt(referenceBlock) > BigInt(latestBlock) ? BigInt(referenceBlock) - BigInt(latestBlock) : 0n)
          : null;
        return {
          id: target.id,
          name: target.name,
          region: target.region,
          serviceId: target.serviceId,
          status: candidate?.state ?? (sample?.success ? "HEALTHY" : sample ? "UNAVAILABLE" : "UNKNOWN"),
          lastProbeAt: sample?.observedAt ?? null,
          availabilityPpm: aggregate?.availabilityPpm ?? null,
          errorRatePpm: aggregate?.errorRatePpm ?? null,
          p95LatencyMs: aggregate?.p95LatencyMs ?? null,
          blockLag,
          blockLagKnown: aggregate?.blockLagKnown ?? false,
          stale: aggregate?.stale ?? sample?.stale ?? false,
          indexedAt: aggregate?.windowEnd ?? sample?.observedAt ?? target.updatedAt,
        };
      });
      return reply.send(responseData(rows, { source: "indexed_monitoring_state" }));
    } catch (error) {
      deps.logger?.error({ err: error }, "Monitoring read failed");
      return reply.code(503).send({ error: "Monitoring data temporarily unavailable" });
    }
  });

  const resources = ["providers", "services", "pacts", "coverages", "incidents", "evidence", "challenges", "claims"] as const;
  for (const resource of resources) {
    app.get(`/api/v1/${resource}`, async (request, reply) => {
      try {
        const query = request.query as Record<string, unknown>;
        const page = pageQuery(query);
        const incidentId = queryText(query.incidentId, "incidentId");
        if (incidentId !== undefined && !/^\d+$/.test(incidentId)) throw new ApiInputError("incidentId must be an unsigned decimal string");
        const [result, cursor] = await Promise.all([
          listIndexed(deps.db, resource, { deploymentId: deps.deploymentId, skip: page.cursor, take: page.limit, search: queryText(query.search, "search"), status: queryText(query.status, "status"), serviceId: queryText(query.serviceId, "serviceId"), providerId: queryText(query.providerId, "providerId"), buyer: queryText(query.buyer, "buyer"), claimant: queryText(query.claimant, "claimant"), incidentId, faultDomain: queryText(query.faultDomain, "faultDomain") }),
          deps.db.syncCursor.findUnique({ where: { deploymentId_entityKind: { deploymentId: deps.deploymentId, entityKind: "all" } }, select: { lastSuccessAt: true } }),
        ]);
        return reply.send(responseData(result.rows, { pagination: { cursor: page.cursor, limit: page.limit, total: result.total, nextCursor: page.cursor + result.rows.length < result.total ? page.cursor + result.rows.length : null }, indexedAt: cursor?.lastSuccessAt ?? null }));
      } catch (error) { return routeFailure(reply, error, deps.logger); }
    });
  }

  const detailResources = ["providers", "services", "pacts", "coverages", "incidents", "evidence", "challenges", "claims"] as const;
  for (const resource of detailResources) {
    app.get(`/api/v1/${resource}/:id`, async (request, reply) => {
      try {
        const id = onchainId(request.params as Params);
        const model = resource === "providers" ? deps.db.provider : resource === "services" ? deps.db.service : resource === "pacts" ? deps.db.pact : resource === "coverages" ? deps.db.coverage : resource === "incidents" ? deps.db.incident : resource === "evidence" ? deps.db.evidence : resource === "challenges" ? deps.db.challenge : deps.db.claim;
        const include = resource === "pacts"
          ? { terms: true, capacity: true, service: true, provider: true }
          : resource === "providers"
            ? { vault: true, stats: true }
          : resource === "coverages"
              ? { pact: { include: { terms: true, provider: true, service: true } } }
              : undefined;
        const row = await (model as { findFirst: (args: unknown) => Promise<unknown> }).findFirst({ where: { deploymentId: deps.deploymentId, onchainId: id }, ...(include ? { include } : {}) });
        if (!row) return reply.code(404).send({ error: "not found" });
        return reply.send(responseData(row, { source: "indexed_contract_state" }));
      } catch (error) { return routeFailure(reply, error, deps.logger); }
    });
  }

  app.get("/api/v1/pacts/:id/capacity", async (request, reply) => {
    try {
      const pact = await deps.db.pact.findFirst({ where: { deploymentId: deps.deploymentId, onchainId: onchainId(request.params as Params) }, include: { capacity: true } });
      if (!pact) return reply.code(404).send({ error: "not found" });
      return reply.send(responseData(pact.capacity, { source: "indexed_contract_state" }));
    } catch (error) { return routeFailure(reply, error, deps.logger); }
  });
  app.get("/api/v1/incidents/:id/evidence", async (request, reply) => {
    try {
      const incident = await deps.db.incident.findFirst({ where: { deploymentId: deps.deploymentId, onchainId: onchainId(request.params as Params) }, select: { id: true } });
      if (!incident) return reply.code(404).send({ error: "not found" });
      const rows = await deps.db.evidence.findMany({ where: { incidentId: incident.id }, orderBy: { onchainId: "asc" }, take: 100 });
      return reply.send(responseData(rows, { source: "indexed_contract_state" }));
    } catch (error) { return routeFailure(reply, error, deps.logger); }
  });
  app.get("/api/v1/incidents/:id/resolution", async (request, reply) => {
    try {
      const incident = await deps.db.incident.findFirst({ where: { deploymentId: deps.deploymentId, onchainId: onchainId(request.params as Params) }, include: { resolution: true } });
      if (!incident) return reply.code(404).send({ error: "not found" });
      return reply.send(responseData(incident.resolution, { source: "indexed_contract_state" }));
    } catch (error) { return routeFailure(reply, error, deps.logger); }
  });
  app.get("/api/v1/incidents/:id/challenge", async (request, reply) => {
    try {
      const incident = await deps.db.incident.findFirst({ where: { deploymentId: deps.deploymentId, onchainId: onchainId(request.params as Params) }, include: { challenges: { include: { evidence: true } } } });
      if (!incident) return reply.code(404).send({ error: "not found" });
      return reply.send(responseData(incident.challenges[0] ?? null, { source: "indexed_contract_state" }));
    } catch (error) { return routeFailure(reply, error, deps.logger); }
  });

  const artifactHandler = async (request: { params: unknown }, reply: { code: (status: number) => typeof reply; header: (name: string, value: string) => typeof reply; type: (value: string) => typeof reply; send: (value: Buffer) => unknown }) => {
    try {
      const params = request.params as Params;
      if (!params.sha256) throw new ApiInputError("sha256 is required");
      let sha256: string;
      try { sha256 = normalizeHash256(params.sha256); }
      catch { throw new ApiInputError("sha256 must be a 64-character hexadecimal hash"); }
      const artifact = await deps.db.evidenceArtifact.findUnique({ where: { sha256 } });
      if (!artifact) return reply.code(404).send(Buffer.from("not found"));
      return reply.header("ETag", `\"${sha256}\"`).header("Cache-Control", "public, immutable").type(artifact.contentType).send(Buffer.from(artifact.bytes));
    } catch (error) {
      if (error instanceof ApiInputError) return reply.code(400).send(Buffer.from(error.message));
      deps.logger?.error({ err: error }, "Evidence artifact read failed");
      return reply.code(503).send(Buffer.from("temporarily unavailable"));
    }
  };
  app.get("/api/v1/evidence-artifacts/:sha256/raw", artifactHandler as never);
  app.get("/evidence/:sha256", artifactHandler as never);
  app.get("/evidence/:sha256.json", artifactHandler as never);

  app.post("/api/v1/internal/monitor-targets", async (request, reply) => {
    if (!deps.adminToken) return reply.code(404).send({ error: "internal mutation routes are disabled" });
    if (request.headers.authorization !== `Bearer ${deps.adminToken}`) return reply.code(401).send({ error: "unauthorized" });
    const body = request.body as Record<string, unknown>;
    if (typeof body.endpointUrl !== "string" || typeof body.name !== "string" || body.name.length < 1 || body.name.length > 128 || typeof body.expectedChainId !== "number" || body.expectedChainId !== FROZEN_CHAIN_ID || typeof body.region !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.region.trim().toLowerCase())) return reply.code(400).send({ error: "invalid target fields" });
    const intervalMs = typeof body.intervalMs === "number" && Number.isInteger(body.intervalMs) && body.intervalMs >= 1000 && body.intervalMs <= 86_400_000 ? body.intervalMs : 30000;
    const timeoutMs = typeof body.timeoutMs === "number" && Number.isInteger(body.timeoutMs) && body.timeoutMs >= 100 && body.timeoutMs <= 60_000 ? body.timeoutMs : 5000;
    if (body.intervalMs !== undefined && intervalMs === 30000 && body.intervalMs !== 30000) return reply.code(400).send({ error: "intervalMs must be 1000..86400000" });
    if (body.timeoutMs !== undefined && timeoutMs === 5000 && body.timeoutMs !== 5000) return reply.code(400).send({ error: "timeoutMs must be 100..60000" });
    try {
      await resolveSafeEndpoint(body.endpointUrl, { allowHttp: deps.probeHttpAllowed });
    } catch {
      return reply.code(400).send({ error: "endpointUrl must resolve to a public RPC endpoint" });
    }
    try {
      const target = await deps.db.monitorTarget.create({ data: { name: body.name, endpointUrl: body.endpointUrl, expectedChainId: body.expectedChainId, region: body.region.trim().toLowerCase(), profile: (body.profile ?? {}) as never, intervalMs, timeoutMs, evidenceMode: body.evidenceMode === "evidence" || body.evidenceMode === "auto" ? body.evidenceMode : "observe" } });
      return reply.code(201).send(responseData(target));
    } catch (error) { return routeFailure(reply, error, deps.logger); }
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    deps.logger?.error({ err: error }, "API request failed");
    return reply.code(error.statusCode ?? 500).send({ error: error.statusCode && error.statusCode < 500 ? error.message : "internal server error" });
  });
  return app;
}
