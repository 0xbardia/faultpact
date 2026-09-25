import { createLiveAdapter } from "@faultpact/contract";
import { createDb, ensureDeployment } from "@faultpact/db";
import { loadEnv } from "@faultpact/shared";
import { FaultPactIndexer } from "../apps/worker/src/indexer.js";
import { MonitoringWorker } from "../apps/worker/src/monitor.js";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
try {
  const contract = await createLiveAdapter({ minIntervalMs: env.GENLAYER_RPC_MIN_INTERVAL_MS, dailyBudget: env.GENLAYER_RPC_DAILY_BUDGET, ...(env.GENLAYER_RPC_BUDGET_STATE_FILE ? { budgetStateFile: env.GENLAYER_RPC_BUDGET_STATE_FILE } : {}) });
  const verification = await contract.verifyDeployment(undefined, { checkSchema: false });
  const deployment = await ensureDeployment(db, { network: "GenLayer Studio Development Preview", chainId: verification.chainId, contractAddress: contract.address, sourceSha256: verification.sourceSha256, sourceByteLength: verification.sourceByteLength, schemaFingerprint: verification.schemaFingerprint, schema: contract.schema });
  const indexer = new FaultPactIndexer(db, contract, { deploymentId: deployment.id, maxEntityId: 100n, reconcileLimit: env.INDEXER_RECONCILE_LIMIT, rpcCooldownUntil: () => contract.refreshRpcCooldown() });
  const sync = await indexer.syncOnce();
  const monitor = new MonitoringWorker(db, { region: env.PROBE_REGION, mode: env.MONITOR_MODE, timeoutMs: env.PROBE_TIMEOUT_MS, maxResponseBytes: env.PROBE_MAX_RESPONSE_BYTES, evidenceMaxBytes: env.EVIDENCE_MAX_BYTES, rawRetentionSeconds: env.PROBE_RAW_RETENTION_SECONDS, evidencePublicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL, genlayerProbeIntervalMs: env.GENLAYER_RPC_PROBE_INTERVAL_MS, rpcCall: (method, params) => contract.rpcRequest(method, params, { subsystem: "monitor" }), rpcCooldownUntil: () => contract.refreshRpcCooldown() });
  const monitoredTargets = await monitor.runOnce();
  console.log(JSON.stringify({ indexed: sync.indexed, monitoredTargets, deploymentId: sync.deploymentId }));
} finally {
  await db.$disconnect();
}
