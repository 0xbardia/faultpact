import { describe, expect, it, afterAll } from "vitest";
import { assertDbHealthy, createDb, ensureDeployment } from "@faultpact/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for integration tests");
const db = createDb(url);

describe("PostgreSQL integration", () => {
  it("MIGRATION_AND_DEPLOYMENT_STATE", async () => {
    await assertDbHealthy(db);
    const deployment = await ensureDeployment(db, { network: "GenLayer Studio Development Preview", chainId: 61997, contractAddress: "0xeb858957e3C426597245f6b59E260f1cC556Bf13", sourceSha256: "4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e", sourceByteLength: 141351 });
    expect(deployment.id).toBeGreaterThan(0);
    expect(await db.deployment.count()).toBeGreaterThan(0);
  });
});

afterAll(async () => { await db.$disconnect(); });
