import { createServer, type Server } from "node:http";
import { describe, expect, it, afterEach } from "vitest";
import { sha256Bytes } from "@faultpact/shared";
import { aggregateSamples, artifactPublicUrl, assertArtifactSize, buildProbeEvidence, persistImmutableArtifact, probeRpc, ReporterSubmissionGate, reporterPreflight, resolveSafeEndpoint, safeRequest, validateProbeEvidence, type ProbeEvidenceV1 } from "./index.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

async function rpcServer(handler: (method: string, id: number) => { status?: number; body?: unknown; raw?: string; waitMs?: number }): Promise<{ url: string; port: number }> {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = body.trim() ? JSON.parse(body) as { id: number; method: string } : { id: 1, method: "GET" };
    const result = handler(parsed.method, parsed.id);
    if (result.waitMs) await new Promise((resolve) => setTimeout(resolve, result.waitMs));
    response.statusCode = result.status ?? 200;
    response.setHeader("content-type", "application/json");
    const responseBody = result.body && typeof result.body === "object" && !Array.isArray(result.body) ? { ...(result.body as Record<string, unknown>), id: parsed.id } : result.body;
    response.end(result.raw ?? JSON.stringify(responseBody ?? { jsonrpc: "2.0", id: parsed.id, result: "0x1" }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return { url: `http://127.0.0.1:${address.port}`, port: address.port };
}

function healthy(method: string): unknown {
  if (method === "eth_chainId") return "0xf22d";
  if (method === "eth_blockNumber") return "0x64";
  if (method === "eth_getBlockByNumber") return { number: "0x64", timestamp: "0x100", hash: "0xabc" };
  return null;
}

const evidence: ProbeEvidenceV1 = { schema: "faultpact-probe-v1", service_id: 1, region: "frankfurt", observed_start: 100, observed_end: 160, availability_ppm: 1_000_000, p95_latency_ms: 300, error_rate_ppm: 0, block_lag: null, chain_level_failure: false, fault_domain: "PROVIDER", incident_confirmed: true, probe_id: "frankfurt-1", sequence: 1 };

describe("monitoring and evidence", () => {
  it("PROBE_SUCCESS", async () => {
    const server = await rpcServer((method) => ({ body: { jsonrpc: "2.0", result: healthy(method) } }));
    const result = await probeRpc({ probeId: "success", url: server.url, expectedChainId: 61997, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.success).toBe(true);
  });
  it("PROBE_TIMEOUT", async () => {
    const server = await rpcServer(() => ({ waitMs: 50 }));
    const result = await probeRpc({ probeId: "timeout", url: server.url, expectedChainId: 61997, timeoutMs: 5, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.errorCode).toBe("RPC_TRANSPORT");
  });
  it("PROBE_HTTP_429", async () => {
    const server = await rpcServer(() => ({ status: 429, raw: "rate limited" }));
    const result = await probeRpc({ probeId: "429", url: server.url, expectedChainId: 61997, timeoutMs: 100, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.errorCode).toBe("HTTP_429");
    expect(result.errorMessage).toMatch(/429/);
  });
  it("PROBE_HTTP_500", async () => {
    const server = await rpcServer(() => ({ status: 500, raw: "server error" }));
    const result = await probeRpc({ probeId: "500", url: server.url, expectedChainId: 61997, timeoutMs: 100, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.errorCode).toBe("HTTP_500");
  });
  it("PROBE_JSON_RPC_ERROR", async () => {
    const server = await rpcServer(() => ({ body: { jsonrpc: "2.0", error: { code: -32000, message: "overloaded" } } }));
    const result = await probeRpc({ probeId: "rpc-error", url: server.url, expectedChainId: 61997, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.errorCode).toBe("JSON_RPC_ERROR");
  });
  it("PROBE_MALFORMED_JSON", async () => {
    const server = await rpcServer(() => ({ raw: "not json" }));
    const result = await probeRpc({ probeId: "malformed", url: server.url, expectedChainId: 61997, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.errorCode).toBe("MALFORMED_JSON");
  });
  it("PROBE_WRONG_CHAIN", async () => {
    const server = await rpcServer((method) => ({ body: { jsonrpc: "2.0", result: method === "eth_chainId" ? "0x1" : healthy(method) } }));
    const result = await probeRpc({ probeId: "wrong-chain", url: server.url, expectedChainId: 61997, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.errorCode).toBe("WRONG_CHAIN");
  });
  it("PROBE_STALE_HEAD", async () => {
    const server = await rpcServer((method) => ({ body: { jsonrpc: "2.0", result: healthy(method) } }));
    const result = await probeRpc({ probeId: "stale", url: server.url, expectedChainId: 61997, referenceUrl: server.url, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port], staleHead: { previousTarget: 100n, previousReference: 99n, minimumReferenceAdvance: 1n } });
    expect(result.stale).toBe(true);
  });
  it("BLOCK_LAG_UNKNOWN_WITHOUT_REFERENCE", async () => {
    const server = await rpcServer((method) => ({ body: { jsonrpc: "2.0", id: 1, result: healthy(method) } }));
    const result = await probeRpc({ probeId: "no-reference", url: server.url, expectedChainId: 61997, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.blockLagKnown).toBe(false);
    expect(result.blockLag).toBeUndefined();
  });
  it("P95_DETERMINISTIC", () => expect(aggregateSamples([1, 2, 3, 4, 5].map((latencyMs) => ({ success: true, latencyMs, blockLagKnown: false, stale: false }))).p95LatencyMs).toBe(5));
  it("AVAILABILITY_PPM_DETERMINISTIC", () => expect(aggregateSamples([{ success: true, blockLagKnown: false, stale: false }, { success: false, blockLagKnown: false, stale: false }]).availabilityPpm).toBe(500_000n));
  it("ERROR_RATE_PPM_DETERMINISTIC", () => expect(aggregateSamples([{ success: true, blockLagKnown: false, stale: false }, { success: false, blockLagKnown: false, stale: false }]).errorRatePpm).toBe(500_000n));
  it("SSRF_LOOPBACK_REJECTED", async () => await expect(resolveSafeEndpoint("http://127.0.0.1:8080", { allowHttp: true, allowedPorts: [8080] })).rejects.toThrow());
  it("SSRF_IPV6_LOOPBACK_REJECTED", async () => await expect(resolveSafeEndpoint("http://[::1]:8080", { allowHttp: true, allowedPorts: [8080] })).rejects.toThrow());
  it("SSRF_MAPPED_LOOPBACK_REJECTED", async () => await expect(resolveSafeEndpoint("http://[::ffff:127.0.0.1]:8080", { allowHttp: true, allowedPorts: [8080] })).rejects.toThrow());
  it("SSRF_PRIVATE_IP_REJECTED", async () => await expect(resolveSafeEndpoint("http://10.0.0.1:443", { allowHttp: true })).rejects.toThrow());
  it("SSRF_METADATA_IP_REJECTED", async () => await expect(resolveSafeEndpoint("http://169.254.169.254", { allowHttp: true })).rejects.toThrow());
  it("SSRF_REDIRECT_TO_PRIVATE_REJECTED", async () => {
    const server = await rpcServer(() => ({ status: 302, raw: "" }));
    await expect(safeRequest(server.url, { allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] })).rejects.toThrow(/redirect/);
  });
  it("PROBE_OVERSIZED_BODY", async () => {
    const server = await rpcServer(() => ({ raw: "x".repeat(128) }));
    const result = await probeRpc({ probeId: "oversized", url: server.url, expectedChainId: 61997, maxResponseBytes: 32, allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(result.errorCode).toBe("RPC_TRANSPORT");
    expect(result.errorMessage).toMatch(/exceeds configured limit/);
  });
  it("EVIDENCE_CANONICAL_BYTES_STABLE", () => expect(new TextDecoder().decode(buildProbeEvidence(evidence).bytes)).toBe('{"availability_ppm":1000000,"block_lag":null,"chain_level_failure":false,"error_rate_ppm":0,"fault_domain":"PROVIDER","incident_confirmed":true,"observed_end":160,"observed_start":100,"p95_latency_ms":300,"probe_id":"frankfurt-1","region":"frankfurt","schema":"faultpact-probe-v1","sequence":1,"service_id":1}'));
  it("EVIDENCE_SHA256_MATCH", () => { const built = buildProbeEvidence(evidence); expect(built.sha256).toMatch(/^[a-f0-9]{64}$/); });
  it("EVIDENCE_SIZE_LIMIT", () => { const built = buildProbeEvidence(evidence); expect(() => assertArtifactSize({ sizeBytes: built.bytes.byteLength }, 1)).toThrow(/size limit/); });
  it("EVIDENCE_HTTP_BYTES_MATCH_HASH", async () => {
    const built = buildProbeEvidence(evidence);
    const server = await rpcServer(() => ({ raw: new TextDecoder().decode(built.bytes) }));
    const response = await safeRequest(server.url, { allowHttp: true, allowPrivateNetworks: true, allowedPorts: [server.port] });
    expect(sha256Bytes(response.body)).toBe(built.sha256);
    expect(response.body.equals(built.bytes)).toBe(true);
  });
  it("EVIDENCE_ARTIFACT_IMMUTABLE", async () => {
    const stored = new Map<string, Uint8Array>();
    const repository = { findBySha256: async (sha256: string) => stored.has(sha256) ? { sha256, bytes: stored.get(sha256) as Uint8Array } : null, create: async (artifact: { sha256: string; bytes: Buffer }) => { if (stored.has(artifact.sha256)) throw new Error("duplicate"); stored.set(artifact.sha256, artifact.bytes); } };
    const artifact = await persistImmutableArtifact(repository, evidence, { test: true });
    const second = await persistImmutableArtifact(repository, evidence, { test: true });
    expect(second.sha256).toBe(artifact.sha256);
    expect(artifactPublicUrl("https://faultpact.bydx.fun/evidence", artifact)).toContain(`${artifact.sha256}.json`);
  });
  it("UNAUTHORIZED_REPORTER_CANNOT_SUBMIT", async () => {
    const result = await new ReporterSubmissionGate({ enabled: true, reporterAddress: "0x0000000000000000000000000000000000000001", authorized: false, hasPrivateKey: true }).submit({ existsOnchain: async () => false, send: async () => { throw new Error("must not send"); } });
    expect(result.result).toBe("UNAUTHORIZED");
  });
  it("MONITOR_ONLY_WITHOUT_REPORTER_KEY", async () => {
    const result = await reporterPreflight({ hasPrivateKey: false, isAuthorized: async () => true });
    expect(result.mode).toBe("MONITOR_ONLY");
  });
  it("AUTHORIZED_REPORTER_PREFLIGHT", async () => {
    const result = await reporterPreflight({ reporterAddress: "0x0000000000000000000000000000000000000001", hasPrivateKey: true, isAuthorized: async () => true });
    expect(result.mode).toBe("AUTHORIZED_SUBMISSION");
  });
  it("NO_REPORTER_KEY_LOGGING", () => expect(JSON.stringify({ mode: "MONITOR_ONLY", reason: "REPORTER_PRIVATE_KEY is not configured" })).not.toContain("0x"));
  it("DUPLICATE_SUBMISSION_RETRY_SAFE", async () => {
    let sends = 0;
    const gate = new ReporterSubmissionGate({ enabled: true, reporterAddress: "0x0000000000000000000000000000000000000001", authorized: true, hasPrivateKey: true });
    const first = await gate.submit({ existsOnchain: async () => false, send: async () => { sends += 1; return "tx"; } });
    const second = await gate.submit({ existsOnchain: async () => true, send: async () => { sends += 1; return "duplicate"; } });
    expect(first.result).toBe("SUBMITTED");
    expect(second.result).toBe("ALREADY_ONCHAIN");
    expect(sends).toBe(1);
  });
  it("SUPPLEMENTAL_SIGNAL_NOT_FINAL_TRUTH", () => expect(() => validateProbeEvidence({ ...evidence, incident_confirmed: false, fault_domain: "PROVIDER" })).toThrow());
  it("CONTRACT_REMAINS_SOURCE_OF_TRUTH", () => expect(validateProbeEvidence({ ...evidence, incident_confirmed: true }).schema).toBe("faultpact-probe-v1"));
});
