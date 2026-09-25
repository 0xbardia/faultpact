import { createLiveAdapter } from "@faultpact/contract";
import { loadEnv } from "@faultpact/shared";

const env = loadEnv();
const adapter = await createLiveAdapter({ minIntervalMs: env.GENLAYER_RPC_MIN_INTERVAL_MS, dailyBudget: env.GENLAYER_RPC_DAILY_BUDGET, ...(env.GENLAYER_RPC_BUDGET_STATE_FILE ? { budgetStateFile: env.GENLAYER_RPC_BUDGET_STATE_FILE } : {}) });
const verification = await adapter.verifyDeployment();
console.log(JSON.stringify({ verification, counts: adapter.methodCount, views: adapter.viewMethods, writes: adapter.writeMethods, payables: adapter.payableMethods }, null, 2));
