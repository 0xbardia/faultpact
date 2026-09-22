import pino from "pino";
import { createLiveAdapter } from "@faultpact/contract";
import { createDb, ensureDeployment } from "@faultpact/db";
import { loadEnv } from "@faultpact/shared";
import { buildApp } from "./app.js";

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: "faultpact-api" } });
const db = createDb(env.DATABASE_URL);
const contract = await createLiveAdapter();
// The frozen schema snapshot is the runtime API authority. Live schema
// discovery is performed by the explicit certification command, not every API
// restart, so an external 429 cannot create a startup request storm.
const verification = await contract.verifyDeployment(undefined, { checkSchema: false });
const deployment = await ensureDeployment(db, { network: "GenLayer Studio Development Preview", chainId: verification.chainId, contractAddress: contract.address, sourceSha256: verification.sourceSha256, sourceByteLength: verification.sourceByteLength, schemaFingerprint: verification.schemaFingerprint, schema: contract.schema });
const app = await buildApp({ db, contract, deploymentId: deployment.id, ...(env.ADMIN_API_TOKEN ? { adminToken: env.ADMIN_API_TOKEN } : {}), evidencePublicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL, probeHttpAllowed: env.PROBE_HTTP_ALLOWED, logger });
try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info({ host: env.API_HOST, port: env.API_PORT }, "API listening");
} catch (error) {
  logger.error({ err: error }, "API failed to start");
  await db.$disconnect();
  process.exitCode = 1;
}
