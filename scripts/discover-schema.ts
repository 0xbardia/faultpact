import { createLiveAdapter } from "@faultpact/contract";
import { loadEnv } from "@faultpact/shared";

loadEnv();
const adapter = await createLiveAdapter();
const verification = await adapter.verifyDeployment();
console.log(JSON.stringify({ verification, counts: adapter.methodCount, views: adapter.viewMethods, writes: adapter.writeMethods, payables: adapter.payableMethods }, null, 2));
