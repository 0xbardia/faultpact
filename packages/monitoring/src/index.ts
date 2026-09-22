import { createHash } from "node:crypto";
import { request as httpRequest, type RequestOptions as HttpRequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { canonicalJson, normalizeHash256, sha256Bytes, type JsonValue } from "@faultpact/shared";

export type SsrfPolicy = {
  allowHttp?: boolean;
  allowPrivateNetworks?: boolean;
  allowedPorts?: readonly number[];
  maxRedirects?: number;
};

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

function ipv4Forbidden(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function ipv6Forbidden(address: string): boolean {
  const value = address.toLowerCase().split("%")[0] ?? "";
  const halves = value.split("::");
  if (halves.length > 2) return true;
  const parsePart = (part: string): number[] => {
    if (part.includes(".")) {
      const octets = part.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return [];
      return [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) return [];
    return [Number.parseInt(part, 16)];
  };
  const left = halves[0] ? halves[0].split(":").flatMap(parsePart) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").flatMap(parsePart) : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return true;
  const words = halves.length === 2 ? [...left, ...Array.from({ length: missing }, () => 0), ...right] : left;
  if (words.length !== 8) return true;
  const first = words[0] ?? 0;
  const low32 = ((words[6] ?? 0) * 0x10000) + (words[7] ?? 0);
  if (words.slice(0, 5).every((word) => word === 0) && (words[5] === 0 || words[5] === 0xffff)) {
    return ipv4Forbidden(`${low32 >>> 24}.${(low32 >>> 16) & 255}.${(low32 >>> 8) & 255}.${low32 & 255}`);
  }
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00 || words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1);
}

export function isPrivateOrSpecialIp(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? ipv4Forbidden(address) : family === 6 ? ipv6Forbidden(address) : true;
}

export async function resolveSafeEndpoint(rawUrl: string, policy: SsrfPolicy = {}): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new SsrfError("invalid URL"); }
  const allowHttp = policy.allowHttp ?? false;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) throw new SsrfError("only HTTPS endpoints are allowed");
  if (url.username || url.password) throw new SsrfError("credentials in URL are not allowed");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || !(policy.allowedPorts ?? [80, 443]).includes(port)) throw new SsrfError("endpoint port is not allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname === "metadata.google.internal" || hostname === "instance-data.ec2.internal") throw new SsrfError("local or metadata hostname is not allowed");
  const answers = await lookup(hostname, { all: true, verbatim: true });
  if (answers.length === 0) throw new SsrfError("hostname has no address");
  const addresses = answers.map((answer) => answer.address);
  if (!(policy.allowPrivateNetworks ?? false) && addresses.some(isPrivateOrSpecialIp)) throw new SsrfError("endpoint resolves to a private or special network");
  return { url, addresses };
}

type SafeRequestOptions = SsrfPolicy & {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
};

export type SafeResponse = { status: number; headers: Record<string, string>; body: Buffer };

export async function safeRequest(rawUrl: string, options: SafeRequestOptions = {}): Promise<SafeResponse> {
  const { url, addresses } = await resolveSafeEndpoint(rawUrl, options);
  const address = addresses[0];
  if (!address) throw new SsrfError("no resolved address");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const maxBytes = options.maxBytes ?? 262144;
  const timeoutMs = options.timeoutMs ?? 5000;
  const headers = { ...(options.headers ?? {}), ...(options.body ? { "content-length": String(options.body.byteLength) } : {}) };
  const requestOptions: HttpRequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port,
    path: `${url.pathname}${url.search}`,
    method: options.method ?? "GET",
    headers,
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, addresses.map((resolved) => ({ address: resolved, family: isIP(resolved) })));
      else callback(null, address, isIP(address));
    },
  };
  return await new Promise<SafeResponse>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requestFn(requestOptions, (response) => {
      if (response.statusCode !== undefined && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        fail(new SsrfError("redirects are disabled for monitored endpoints"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxBytes) {
          response.destroy();
          fail(new Error("response body exceeds configured limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) if (typeof value === "string") responseHeaders[key] = value;
        settled = true;
        resolve({ status: response.statusCode ?? 0, headers: responseHeaders, body: Buffer.concat(chunks) });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("request timeout")));
    request.on("error", (error) => fail(error));
    if (options.body) request.write(options.body);
    request.end();
  });
}

export type RpcCallResult = { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };

export class JsonRpcClient {
  private nextId = 1;
  constructor(private readonly url: string, private readonly options: SsrfPolicy & { timeoutMs?: number; maxResponseBytes?: number } = {}) {}

  async call(method: string, params: readonly unknown[] = []): Promise<unknown> {
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }), "utf8");
    let response: SafeResponse;
    try {
      response = await safeRequest(this.url, { ...this.options, method: "POST", body, headers: { "content-type": "application/json", accept: "application/json" }, maxBytes: this.options.maxResponseBytes ?? 262144 });
    } catch (error) {
      throw new RpcProbeError("RPC_TRANSPORT", error instanceof Error ? error.message : "RPC request failed");
    }
    if (response.status === 429) throw new RpcProbeError("HTTP_429", "RPC rate limited (HTTP 429)");
    if (response.status < 200 || response.status >= 300) throw new RpcProbeError(`HTTP_${response.status}`, `RPC HTTP status ${response.status}`);
    let parsed: unknown;
    try { parsed = JSON.parse(response.body.toString("utf8")) as unknown; } catch { throw new RpcProbeError("MALFORMED_JSON", "RPC returned malformed JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RpcProbeError("MALFORMED_JSON_RPC", "RPC response is not an object");
    const record = parsed as Record<string, unknown>;
    if (record.jsonrpc !== "2.0" || record.id !== id) throw new RpcProbeError("INVALID_JSON_RPC", "RPC version or response id mismatch");
    if (record.error && typeof record.error === "object") {
      const rpcError = record.error as { code?: unknown; message?: unknown; data?: unknown };
      throw new RpcProbeError("JSON_RPC_ERROR", typeof rpcError.message === "string" ? rpcError.message : "JSON-RPC error", typeof rpcError.code === "number" ? rpcError.code : undefined);
    }
    if (!("result" in record)) throw new RpcProbeError("INVALID_JSON_RPC", "RPC response has neither result nor error");
    return record.result;
  }
}

export class RpcProbeError extends Error {
  constructor(readonly code: string, message: string, readonly rpcCode?: number) {
    super(message);
    this.name = "RpcProbeError";
  }
}

function hexNumber(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new RpcProbeError("INVALID_RPC_RESULT", `${field} is not a hex quantity`);
  return BigInt(value);
}

export type RpcProbeResult = {
  probeId: string;
  observedAt: Date;
  success: boolean;
  latencyMs?: number;
  httpStatus?: number;
  expectedChainId: number;
  observedChainId?: number;
  targetBlock?: bigint;
  referenceBlock?: bigint;
  blockLag?: bigint;
  blockLagKnown: boolean;
  stale: boolean;
  errorCode?: string;
  errorMessage?: string;
  raw?: JsonValue;
};

export async function probeRpc(input: {
  probeId: string;
  url: string;
  expectedChainId: number;
  referenceUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowHttp?: boolean;
  allowPrivateNetworks?: boolean;
  allowedPorts?: readonly number[];
  staleHead?: { previousTarget?: bigint; previousReference?: bigint; minimumReferenceAdvance?: bigint };
}): Promise<RpcProbeResult> {
  const started = process.hrtime.bigint();
  const observedAt = new Date();
  try {
    const client = new JsonRpcClient(input.url, { ...(input.allowHttp === undefined ? {} : { allowHttp: input.allowHttp }), ...(input.allowPrivateNetworks === undefined ? {} : { allowPrivateNetworks: input.allowPrivateNetworks }), ...(input.allowedPorts === undefined ? {} : { allowedPorts: input.allowedPorts }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.maxResponseBytes === undefined ? {} : { maxResponseBytes: input.maxResponseBytes }) });
    const chainRaw = await client.call("eth_chainId");
    const observedChainId = Number(hexNumber(chainRaw, "chainId"));
    const targetBlock = hexNumber(await client.call("eth_blockNumber"), "blockNumber");
    const block = await client.call("eth_getBlockByNumber", ["latest", false]);
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new RpcProbeError("INVALID_BLOCK", "latest block is not an object");
    const blockRecord = block as Record<string, unknown>;
    hexNumber(blockRecord.number, "block.number");
    hexNumber(blockRecord.timestamp, "block.timestamp");
    let referenceBlock: bigint | undefined;
    if (input.referenceUrl) {
      const reference = new JsonRpcClient(input.referenceUrl, { ...(input.allowHttp === undefined ? {} : { allowHttp: input.allowHttp }), ...(input.allowPrivateNetworks === undefined ? {} : { allowPrivateNetworks: input.allowPrivateNetworks }), ...(input.allowedPorts === undefined ? {} : { allowedPorts: input.allowedPorts }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.maxResponseBytes === undefined ? {} : { maxResponseBytes: input.maxResponseBytes }) });
      referenceBlock = hexNumber(await reference.call("eth_blockNumber"), "referenceBlock");
    }
    const blockLagKnown = referenceBlock !== undefined;
    const blockLag = blockLagKnown && referenceBlock !== undefined ? (referenceBlock > targetBlock ? referenceBlock - targetBlock : 0n) : undefined;
    const stale = input.staleHead?.previousTarget !== undefined && input.staleHead.previousReference !== undefined && referenceBlock !== undefined && targetBlock === input.staleHead.previousTarget && referenceBlock >= input.staleHead.previousReference + (input.staleHead.minimumReferenceAdvance ?? 1n);
    const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return { probeId: input.probeId, observedAt, success: observedChainId === input.expectedChainId, latencyMs, expectedChainId: input.expectedChainId, observedChainId, targetBlock, referenceBlock, blockLag, blockLagKnown, stale, ...(observedChainId === input.expectedChainId ? {} : { errorCode: "WRONG_CHAIN", errorMessage: `expected ${input.expectedChainId}, got ${observedChainId}` }), raw: { chainId: observedChainId, targetBlock: targetBlock.toString(), referenceBlock: referenceBlock?.toString() ?? null } };
  } catch (error) {
    const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const code = error instanceof RpcProbeError ? error.code : error instanceof SsrfError ? "SSRF_REJECTED" : "PROBE_ERROR";
    return { probeId: input.probeId, observedAt, success: false, latencyMs, expectedChainId: input.expectedChainId, blockLagKnown: false, stale: false, errorCode: code, errorMessage: error instanceof Error ? error.message : "probe failed" };
  }
}

export type MetricSample = { success: boolean; latencyMs?: number; targetBlock?: bigint; referenceBlock?: bigint; blockLag?: bigint; blockLagKnown: boolean; stale: boolean };

export function ppm(numerator: number, denominator: number): bigint {
  if (denominator <= 0 || numerator < 0 || numerator > denominator) throw new Error("invalid PPM inputs");
  return (BigInt(numerator) * 1_000_000n) / BigInt(denominator);
}

export function nearestRank(values: readonly number[], quantile: number): number | undefined {
  if (values.length === 0) return undefined;
  if (!(quantile > 0 && quantile <= 1)) throw new Error("quantile must be in (0,1]");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(quantile * sorted.length));
  return sorted[rank - 1];
}

export type Aggregate = {
  sampleCount: number;
  successCount: number;
  failureCount: number;
  availabilityPpm: bigint;
  errorRatePpm: bigint;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
  maxLatencyMs?: number;
  latestBlock?: bigint;
  referenceBlock?: bigint;
  blockLagKnown: boolean;
  stale: boolean;
};

export function aggregateSamples(samples: readonly MetricSample[]): Aggregate {
  const successCount = samples.filter((sample) => sample.success).length;
  const latencies = samples.flatMap((sample) => sample.latencyMs === undefined ? [] : [sample.latencyMs]);
  const knownLags = samples.filter((sample) => sample.blockLagKnown && sample.blockLag !== undefined);
  return {
    sampleCount: samples.length,
    successCount,
    failureCount: samples.length - successCount,
    availabilityPpm: ppm(successCount, samples.length),
    errorRatePpm: ppm(samples.length - successCount, samples.length),
    p50LatencyMs: nearestRank(latencies, 0.5),
    p95LatencyMs: nearestRank(latencies, 0.95),
    maxLatencyMs: latencies.length ? Math.max(...latencies) : undefined,
    latestBlock: samples.flatMap((sample) => sample.targetBlock === undefined ? [] : [sample.targetBlock]).sort((a, b) => a > b ? -1 : 1)[0],
    referenceBlock: samples.flatMap((sample) => sample.referenceBlock === undefined ? [] : [sample.referenceBlock]).sort((a, b) => a > b ? -1 : 1)[0],
    blockLagKnown: knownLags.length > 0,
    stale: samples.some((sample) => sample.stale),
  };
}

export type ProbeEvidenceV1 = {
  schema: "faultpact-probe-v1";
  service_id: number;
  region: string;
  observed_start: number;
  observed_end: number;
  availability_ppm: number | null;
  p95_latency_ms: number | null;
  error_rate_ppm: number | null;
  block_lag: number | null;
  chain_level_failure: boolean;
  fault_domain: "PROVIDER" | "CHAIN" | "CUSTOMER" | "SHARED" | "UNKNOWN";
  incident_confirmed: boolean;
  probe_id: string;
  sequence: number;
};

export function validateProbeEvidence(value: unknown): ProbeEvidenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("probe artifact must be an object");
  const object = value as Record<string, unknown>;
  const expectedKeys = ["schema", "service_id", "region", "observed_start", "observed_end", "availability_ppm", "p95_latency_ms", "error_rate_ppm", "block_lag", "chain_level_failure", "fault_domain", "incident_confirmed", "probe_id", "sequence"];
  if (Object.keys(object).sort().join("\0") !== expectedKeys.sort().join("\0")) throw new Error("probe artifact keys do not match faultpact-probe-v1");
  if (object.schema !== "faultpact-probe-v1") throw new Error("unsupported probe schema");
  const integers = ["service_id", "observed_start", "observed_end", "sequence"] as const;
  for (const key of integers) if (typeof object[key] !== "number" || !Number.isSafeInteger(object[key]) || object[key] < 0) throw new Error(`${key} must be a non-negative safe integer`);
  if ((object.observed_end as number) <= (object.observed_start as number)) throw new Error("probe window must be positive");
  if (typeof object.region !== "string" || object.region.trim() !== object.region || object.region.length < 1 || object.region.length > 64 || object.region.toLowerCase() !== object.region) throw new Error("region must be normalized lowercase text");
  if (typeof object.probe_id !== "string" || object.probe_id.length < 1 || object.probe_id.length > 128) throw new Error("probe_id is invalid");
  if (typeof object.chain_level_failure !== "boolean" || typeof object.incident_confirmed !== "boolean") throw new Error("boolean probe fields are invalid");
  if (!["PROVIDER", "CHAIN", "CUSTOMER", "SHARED", "UNKNOWN"].includes(String(object.fault_domain))) throw new Error("fault_domain is invalid");
  if (object.incident_confirmed === false && object.fault_domain !== "UNKNOWN") throw new Error("unconfirmed probe must use UNKNOWN fault domain");
  for (const key of ["availability_ppm", "error_rate_ppm"] as const) if (object[key] !== null && (typeof object[key] !== "number" || !Number.isSafeInteger(object[key]) || object[key] < 0 || object[key] > 1_000_000)) throw new Error(`${key} is out of bounds`);
  if (object.p95_latency_ms !== null && (typeof object.p95_latency_ms !== "number" || !Number.isSafeInteger(object.p95_latency_ms) || object.p95_latency_ms < 0 || object.p95_latency_ms > 86_400_000)) throw new Error("p95_latency_ms is out of bounds");
  if (object.block_lag !== null && (typeof object.block_lag !== "number" || !Number.isSafeInteger(object.block_lag) || object.block_lag < 0 || object.block_lag > 10_000_000)) throw new Error("block_lag is out of bounds");
  return object as ProbeEvidenceV1;
}

export function buildProbeEvidence(input: ProbeEvidenceV1): { value: ProbeEvidenceV1; bytes: Buffer; sha256: string } {
  const value = validateProbeEvidence(input);
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  const sha256 = sha256Bytes(bytes);
  if (sha256 !== createHash("sha256").update(bytes).digest("hex")) throw new Error("evidence hash self-check failed");
  return { value, bytes, sha256 };
}

export function evidenceUrl(baseUrl: string, sha256: string): string {
  const normalized = normalizeHash256(sha256);
  return `${baseUrl.replace(/\/$/, "")}/${normalized}.json`;
}

export type CandidateState = "HEALTHY" | "SUSPECTED" | "ACTIVE" | "RECOVERING" | "CLOSED" | "EVIDENCE_READY";

export function nextCandidateState(input: { state: CandidateState; failures: number; recoveries: number; requiredFailures: number; requiredRecoveries: number; evidenceReady: boolean }): CandidateState {
  if (input.evidenceReady) return "EVIDENCE_READY";
  if (input.state === "HEALTHY" && input.failures >= input.requiredFailures) return "SUSPECTED";
  if ((input.state === "SUSPECTED" || input.state === "RECOVERING") && input.failures >= input.requiredFailures) return "ACTIVE";
  if (input.state === "ACTIVE" && input.recoveries >= input.requiredRecoveries) return "RECOVERING";
  if (input.state === "RECOVERING" && input.recoveries >= input.requiredRecoveries) return "CLOSED";
  return input.state;
}

export type ReporterMode = "MONITOR_ONLY" | "AUTHORIZED_SUBMISSION";

export async function reporterPreflight(input: { reporterAddress?: string; hasPrivateKey: boolean; isAuthorized: (address: string) => Promise<boolean> }): Promise<{ mode: ReporterMode; reporterAddress?: string; reason?: string }> {
  if (!input.hasPrivateKey || !input.reporterAddress) return { mode: "MONITOR_ONLY", reason: "REPORTER_PRIVATE_KEY is not configured" };
  if (!(await input.isAuthorized(input.reporterAddress))) return { mode: "MONITOR_ONLY", reporterAddress: input.reporterAddress, reason: "reporter is not authorized onchain" };
  return { mode: "AUTHORIZED_SUBMISSION", reporterAddress: input.reporterAddress };
}

export * from "./artifacts.js";
export * from "./submission.js";
