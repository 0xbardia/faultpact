import pino from "pino";
import { createAccount } from "genlayer-js";
import { createLiveAdapter } from "@faultpact/contract";
import { createDb } from "@faultpact/db";
import { reporterPreflight } from "@faultpact/monitoring";
import { loadEnv } from "@faultpact/shared";
import { FaultPactIndexer } from "./indexer.js";
import { MonitoringWorker } from "./monitor.js";

const env = loadEnv();
if (env.AUTO_ONCHAIN_SUBMISSION) throw new Error("AUTO_ONCHAIN_SUBMISSION is fail-closed: a signer transport must be explicitly implemented and verified before enabling it");
const logger = pino({ level: env.LOG_LEVEL, base: { service: "faultpact-worker", region: env.PROBE_REGION, mode: env.MONITOR_MODE } });
const db = createDb(env.DATABASE_URL);
const contract = await createLiveAdapter({ minIntervalMs: env.GENLAYER_RPC_MIN_INTERVAL_MS, dailyBudget: env.GENLAYER_RPC_DAILY_BUDGET, ...(env.GENLAYER_RPC_BUDGET_STATE_FILE ? { budgetStateFile: env.GENLAYER_RPC_BUDGET_STATE_FILE } : {}) });
const reporterAccount = env.REPORTER_PRIVATE_KEY ? createAccount(env.REPORTER_PRIVATE_KEY as `0x${string}`) : undefined;
const reporterStatus = await reporterPreflight({ hasPrivateKey: reporterAccount !== undefined, ...(reporterAccount ? { reporterAddress: reporterAccount.address } : {}), isAuthorized: (address) => contract.isAuthorizedReporter(address, { subsystem: "reporter_preflight" }) }).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (!/\b429\b|cooldown|rate limit|daily budget|scheduler state/i.test(message)) throw error;
  logger.warn({ err: error }, "reporter preflight deferred; monitoring continues in fail-safe mode");
  return { mode: "MONITOR_ONLY" as const, reason: "RPC unavailable during reporter preflight" };
});
const indexer = new FaultPactIndexer(db, contract, { logger, rpcCooldownUntil: () => contract.refreshRpcCooldown(), configRefreshIntervalMs: env.INDEXER_RECONCILE_INTERVAL_MS, reconcileLimit: env.INDEXER_RECONCILE_LIMIT });
const monitor = new MonitoringWorker(db, { region: env.PROBE_REGION, mode: env.MONITOR_MODE, timeoutMs: env.PROBE_TIMEOUT_MS, maxResponseBytes: env.PROBE_MAX_RESPONSE_BYTES, evidenceMaxBytes: env.EVIDENCE_MAX_BYTES, rawRetentionSeconds: env.PROBE_RAW_RETENTION_SECONDS, genlayerProbeIntervalMs: env.GENLAYER_RPC_PROBE_INTERVAL_MS, rpcCall: (method, params) => contract.rpcRequest(method, params, { subsystem: "monitor" }), rpcCooldownUntil: () => contract.refreshRpcCooldown(), evidencePublicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL, reporterMode: reporterStatus.mode, ...(env.PROBE_REFERENCE_RPC_URL ? { referenceUrl: env.PROBE_REFERENCE_RPC_URL } : {}), logger });
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
logger.info({ chainId: contract.chainId, address: contract.address, indexerPollIntervalMs: env.INDEXER_POLL_INTERVAL_MS, reconcileIntervalMs: env.INDEXER_RECONCILE_INTERVAL_MS, genlayerProbeIntervalMs: env.GENLAYER_RPC_PROBE_INTERVAL_MS, rpcMinIntervalMs: env.GENLAYER_RPC_MIN_INTERVAL_MS, rpcDailyBudget: env.GENLAYER_RPC_DAILY_BUDGET, sharedSchedulerState: env.GENLAYER_RPC_BUDGET_STATE_FILE ?? "production-default" }, "worker starting");
logger.info({ reporterMode: reporterStatus.mode, reason: reporterStatus.reason }, "reporter preflight complete");
const rpcMetricsTimer = setInterval(() => {
  void contract.rpcSchedulerSnapshot()
    .then((rpc) => logger.info({ rpc, cooldownUntil: rpc?.cooldownUntil || null }, "RPC scheduler metrics"))
    .catch((error) => logger.warn({ err: error }, "RPC scheduler metrics unavailable"));
}, env.GENLAYER_RPC_METRICS_INTERVAL_MS);
try { await Promise.all([indexer.run(env.INDEXER_POLL_INTERVAL_MS, env.INDEXER_RECONCILE_INTERVAL_MS, controller.signal), monitor.run(env.PROBE_INTERVAL_MS, controller.signal)]); }
finally { clearInterval(rpcMetricsTimer); }
await db.$disconnect();
