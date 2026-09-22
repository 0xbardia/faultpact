import { createLiveAdapter } from "@faultpact/contract";
import { createDb } from "@faultpact/db";
import { loadEnv } from "@faultpact/shared";
import { FaultPactIndexer } from "../apps/worker/src/indexer.js";
import { MonitoringWorker } from "../apps/worker/src/monitor.js";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
try {
const contract = await createLiveAdapter();
await contract.verifyDeployment(undefined, { checkSchema: false });
  const indexer = new FaultPactIndexer(db, contract, { maxEntityId: 100n, rpcMinIntervalMs: 250 });
  const sync = await indexer.syncOnce();
  const monitor = new MonitoringWorker(db, { region: env.PROBE_REGION, mode: env.MONITOR_MODE, timeoutMs: env.PROBE_TIMEOUT_MS, maxResponseBytes: env.PROBE_MAX_RESPONSE_BYTES, evidenceMaxBytes: env.EVIDENCE_MAX_BYTES, rawRetentionSeconds: env.PROBE_RAW_RETENTION_SECONDS, evidencePublicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL });
  const monitoredTargets = await monitor.runOnce();
  console.log(JSON.stringify({ indexed: sync.indexed, monitoredTargets, deploymentId: sync.deploymentId }));
} finally {
  await db.$disconnect();
}
