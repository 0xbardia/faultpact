import { createLiveAdapter } from "@faultpact/contract";
import { createDb, ensureDeployment } from "@faultpact/db";
import { loadEnv } from "@faultpact/shared";
import { buildApp } from "../apps/api/src/app.js";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
try {
  const contract = await createLiveAdapter();
  const verification = await contract.verifyDeployment(undefined, { checkSchema: false });
  const deployment = await ensureDeployment(db, { network: "GenLayer Studio Development Preview", chainId: verification.chainId, contractAddress: contract.address, sourceSha256: verification.sourceSha256, sourceByteLength: verification.sourceByteLength, schemaFingerprint: verification.schemaFingerprint, schema: contract.schema });
  const app = await buildApp({ db, contract, deploymentId: deployment.id, ...(env.ADMIN_API_TOKEN ? { adminToken: env.ADMIN_API_TOKEN } : {}), evidencePublicBaseUrl: env.EVIDENCE_PUBLIC_BASE_URL, probeHttpAllowed: env.PROBE_HTTP_ALLOWED });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  if (!response.ok) throw new Error(`health returned HTTP ${response.status}`);
  console.log(JSON.stringify({ health: response.status, deployment: contract.address, chainId: contract.chainId }));
  await app.close();
} finally {
  await db.$disconnect();
}
