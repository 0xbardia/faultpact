import pino from "pino";
import { createLiveAdapter, FROZEN_CHAIN_ID, FROZEN_CONTRACT_ADDRESS, FROZEN_SOURCE_SHA256 } from "@faultpact/contract";
import { createDb, ensureDeployment } from "@faultpact/db";
import { loadEnv, normalizeAddress } from "@faultpact/shared";
import { buildApp } from "./app.js";

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: "faultpact-api" } });
const db = createDb(env.DATABASE_URL);
const contract = await createLiveAdapter({ minIntervalMs: env.GENLAYER_RPC_MIN_INTERVAL_MS, dailyBudget: env.GENLAYER_RPC_DAILY_BUDGET, ...(env.GENLAYER_RPC_BUDGET_STATE_FILE ? { budgetStateFile: env.GENLAYER_RPC_BUDGET_STATE_FILE } : {}) });

function rpcUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|cooldown|rate limit|daily budget|budget state|scheduler state|fetch failed|timeout|timed out|HTTP 5\d\d/i.test(message);
}

let deployment: { id: number };
try {
  // The frozen schema snapshot is the runtime API authority. Live schema
  // discovery is performed by the explicit certification command only.
  const verification = await contract.verifyDeployment(undefined, { checkSchema: false });
  deployment = await ensureDeployment(db, { network: "GenLayer Studio Development Preview", chainId: verification.chainId, contractAddress: contract.address, sourceSha256: verification.sourceSha256, sourceByteLength: verification.sourceByteLength, schemaFingerprint: verification.schemaFingerprint, schema: contract.schema });
} catch (error) {
  if (!rpcUnavailable(error)) throw error;
  const cached = await db.deployment.findFirst({ where: { chainId: FROZEN_CHAIN_ID, contractAddress: FROZEN_CONTRACT_ADDRESS.toLowerCase() }, orderBy: { id: "asc" } });
  if (!cached || cached.sourceSha256 !== FROZEN_SOURCE_SHA256 || normalizeAddress(cached.contractAddress) !== normalizeAddress(FROZEN_CONTRACT_ADDRESS) || !cached.verifiedAt) throw error;
  deployment = cached;
  let startupCooldownUntil = 0;
  try { startupCooldownUntil = await contract.refreshRpcCooldown(); } catch { startupCooldownUntil = 0; }
  logger.warn({ err: error, deploymentId: cached.id, cooldownUntil: startupCooldownUntil || null }, "API starting from cached verified deployment while Studio RPC is unavailable");
}

const app = await buildApp({ db, contract, deploymentId: deployment.id, deploymentVerified: true, reconcileMaxAgeMs: env.INDEXER_RECONCILE_INTERVAL_MS * 2, ...(env.ADMIN_API_TOKEN ? { adminToken: env.ADMIN_API_TOKEN } : {}), evidencePublicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL, probeHttpAllowed: env.PROBE_HTTP_ALLOWED, logger });
const rpcMetricsTimer = setInterval(() => {
  void contract.rpcSchedulerSnapshot()
    .then((rpc) => logger.info({ rpc, cooldownUntil: rpc?.cooldownUntil || null }, "RPC scheduler metrics"))
    .catch((rpcError) => logger.warn({ err: rpcError }, "RPC scheduler metrics unavailable"));
}, env.GENLAYER_RPC_METRICS_INTERVAL_MS);
rpcMetricsTimer.unref();
try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info({ host: env.API_HOST, port: env.API_PORT, deploymentId: deployment.id, indexerPollIntervalMs: env.INDEXER_POLL_INTERVAL_MS, reconcileIntervalMs: env.INDEXER_RECONCILE_INTERVAL_MS, rpcMinIntervalMs: env.GENLAYER_RPC_MIN_INTERVAL_MS, rpcDailyBudget: env.GENLAYER_RPC_DAILY_BUDGET, sharedSchedulerState: env.GENLAYER_RPC_BUDGET_STATE_FILE ?? "production-default" }, "API listening");
} catch (error) {
  clearInterval(rpcMetricsTimer);
  logger.error({ err: error }, "API failed to start");
  await db.$disconnect();
  process.exitCode = 1;
}
