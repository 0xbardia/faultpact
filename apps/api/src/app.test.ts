import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { sha256Bytes } from "@faultpact/shared";

function fakeDb(artifact?: { sha256: string; contentType: string; bytes: Buffer }, lastSuccessAt = new Date()) {
  const providerRows: unknown[] = [];
  return {
    provider: { findMany: async () => providerRows, count: async () => providerRows.length, findFirst: async () => null },
    service: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    pact: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    coverage: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    incident: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    evidence: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    challenge: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    claim: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    protocolSnapshot: { findUnique: async () => null },
    syncCursor: { findUnique: async () => ({ status: "HEALTHY", lastSuccessAt }), findMany: async () => [] },
    workerHeartbeat: { findMany: async () => [] },
    evidenceArtifact: { count: async () => 0, findUnique: async () => artifact ?? null },
    monitorTarget: { create: async (args: unknown) => args },
    $queryRaw: async () => [],
  } as never;
}

describe("Fastify API boundary", () => {
  it("API_HEALTH", async () => {
    const app = await buildApp({ db: fakeDb(), deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.database).toBe("ok");
    await app.close();
  });
  it("API_READY", async () => {
    const app = await buildApp({ db: fakeDb(), deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json().data.checks.indexer).toBe("ok");
    await app.close();
  });
  it("API_READY_DETECTS_STALE_INDEX", async () => {
    const stale = new Date(Date.now() - 120_000);
    const app = await buildApp({ db: fakeDb(undefined, stale), deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json().data.checks.indexer).toBe("degraded");
    await app.close();
  });
  it("API_PAGINATION_BOUNDED", async () => {
    const app = await buildApp({ db: fakeDb(), deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/providers?limit=101" });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
  it("API_INCIDENT_FILTER_REQUIRES_DECIMAL_ID", async () => {
    const app = await buildApp({ db: fakeDb(), deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/claims?incidentId=not-an-id" });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
  it("API_DATABASE_ERRORS_ARE_NOT_EXPOSED_AS_CLIENT_ERRORS", async () => {
    const db = fakeDb() as unknown as { provider: { findMany: () => Promise<unknown[]> } };
    db.provider.findMany = async () => { throw new Error("postgres host and credentials"); };
    const app = await buildApp({ db: db as never, deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/providers" });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("postgres host and credentials");
    await app.close();
  });
  it("INTERNAL_API_REQUIRES_AUTH", async () => {
    const app = await buildApp({ db: fakeDb(), deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false, adminToken: "development-token-123456" });
    const response = await app.inject({ method: "POST", url: "/api/v1/internal/monitor-targets", payload: { name: "target", endpointUrl: "https://example.com/rpc", expectedChainId: 61997, region: "frankfurt" } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
  it("NO_SECRET_LOGGING", async () => {
    const app = await buildApp({ db: fakeDb(), deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/network?token=not-a-secret" });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("REPORTER_PRIVATE_KEY");
    await app.close();
  });
  it("EVIDENCE_HTTP_BYTES_MATCH_HASH", async () => {
    const bytes = Buffer.from('{"immutable":true}', "utf8");
    const sha256 = sha256Bytes(bytes);
    const app = await buildApp({ db: fakeDb({ sha256, contentType: "application/json", bytes }), deploymentId: 1, evidencePublicBaseUrl: "https://faultpact.bydx.fun/evidence", probeHttpAllowed: false });
    const response = await app.inject({ method: "GET", url: `/evidence/${sha256}` });
    expect(response.statusCode).toBe(200);
    expect(Buffer.from(response.rawPayload).equals(bytes)).toBe(true);
    expect(sha256Bytes(Buffer.from(response.rawPayload))).toBe(sha256);
    expect(response.headers["cache-control"]).toBe("public, immutable");
    const jsonResponse = await app.inject({ method: "GET", url: `/evidence/${sha256}.json` });
    expect(jsonResponse.statusCode).toBe(200);
    expect(Buffer.from(jsonResponse.rawPayload).equals(bytes)).toBe(true);
    expect(sha256Bytes(Buffer.from(jsonResponse.rawPayload))).toBe(sha256);
    await app.close();
  });
});
