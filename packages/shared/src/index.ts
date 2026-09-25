import { createHash } from "node:crypto";
import { z } from "zod";

export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
export const HASH256_RE = /^[a-f0-9]{64}$/;
export const FROZEN_CHAIN_ID = 61997;
export const FROZEN_RPC_URL = "https://studio-dev.genlayer.com/api";
export const FROZEN_CONTRACT_ADDRESS = "0xeb858957e3C426597245f6b59E260f1cC556Bf13";
export const FROZEN_SOURCE_SHA256 = "4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e";

/** Evidence types accepted by the frozen contract's submit_evidence. */
export const EVIDENCE_TYPES = ["PROBE_REPORT", "CUSTOMER_LOG", "PROVIDER_LOG", "STATUS_PAGE", "CHAIN_REFERENCE", "THIRD_PARTY_MONITOR", "POSTMORTEM", "OTHER", "PROVIDER_STATEMENT"] as const;
/** Evidence types the frozen contract upgrades to AUTHORITATIVE provenance for an authorized reporter. */
export const AUTHORITATIVE_EVIDENCE_TYPES = ["PROBE_REPORT", "THIRD_PARTY_MONITOR", "CHAIN_REFERENCE"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export function isFrozenRpcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "studio-dev.genlayer.com"
      && (url.port === "" || url.port === "443")
      && url.username === ""
      && url.password === ""
      && url.pathname.replace(/\/+$/, "") === "/api"
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

const optionalEnv = (schema: z.ZodType<string>) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

const intEnv = (fallback: number) =>
  z.preprocess((value) => (value === undefined ? fallback : value), z.coerce.number().int().positive());

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  GENLAYER_RPC_URL: z.string().url().default(FROZEN_RPC_URL),
  GENLAYER_CHAIN_ID: z.coerce.number().int().default(FROZEN_CHAIN_ID),
  FAULTPACT_CONTRACT_ADDRESS: z.string().regex(ADDRESS_RE),
  FAULTPACT_SOURCE_SHA256: z.string().regex(HASH256_RE),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: intEnv(4310),
  INDEXER_POLL_INTERVAL_MS: intEnv(300000),
  INDEXER_RECONCILE_INTERVAL_MS: intEnv(1800000),
  INDEXER_RECONCILE_LIMIT: intEnv(10),
  GENLAYER_RPC_MIN_INTERVAL_MS: intEnv(3000),
  GENLAYER_RPC_DAILY_BUDGET: intEnv(1400),
  GENLAYER_RPC_BUDGET_STATE_FILE: optionalEnv(z.string().min(1)),
  GENLAYER_RPC_METRICS_INTERVAL_MS: intEnv(300000),
  GENLAYER_RPC_PROBE_INTERVAL_MS: intEnv(1800000),
  PROBE_REGION: z.string().trim().min(1).max(64).default("frankfurt"),
  PROBE_INTERVAL_MS: intEnv(30000),
  PROBE_TIMEOUT_MS: intEnv(5000),
  PROBE_HTTP_ALLOWED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  PROBE_MAX_RESPONSE_BYTES: intEnv(262144),
  PROBE_RAW_RETENTION_SECONDS: intEnv(604800),
  PROBE_REFERENCE_RPC_URL: optionalEnv(z.string().url()),
  EVIDENCE_PUBLIC_BASE_URL: z.string().url().default("https://faultpact.bydx.fun/evidence"),
  EVIDENCE_MAX_BYTES: intEnv(65536),
  ADMIN_API_TOKEN: optionalEnv(z.string().min(16)),
  REPORTER_PRIVATE_KEY: optionalEnv(z.string().regex(/^0x[a-fA-F0-9]{64}$/)),
  // Optional key-rotation guard: when set, the signer must derive exactly this public address.
  REPORTER_EXPECTED_ADDRESS: optionalEnv(z.string().regex(ADDRESS_RE)),
  // Explicit OPEN incident used by the signer-backed evidence command and the live integration test.
  FAULTPACT_LIVE_TEST_INCIDENT_ID: optionalEnv(z.string().regex(/^\d+$/)),
  REPORTER_SUBMIT_EVIDENCE_TYPE: z.enum(EVIDENCE_TYPES).default("THIRD_PARTY_MONITOR"),
  REPORTER_MAX_FINALIZATION_WAIT_MS: intEnv(240000),
  AUTO_ONCHAIN_SUBMISSION: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  MONITOR_MODE: z.enum(["observe", "evidence", "auto"]).default("observe"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  if (parsed.data.GENLAYER_CHAIN_ID !== FROZEN_CHAIN_ID || parsed.data.GENLAYER_RPC_URL !== FROZEN_RPC_URL) {
    throw new Error(`FaultPact only supports the frozen Studio Dev network (chain ${FROZEN_CHAIN_ID})`);
  }
  if (normalizeAddress(parsed.data.FAULTPACT_CONTRACT_ADDRESS) !== normalizeAddress(FROZEN_CONTRACT_ADDRESS)) {
    throw new Error("FAULTPACT_CONTRACT_ADDRESS does not match the frozen deployment");
  }
  if (parsed.data.FAULTPACT_SOURCE_SHA256 !== FROZEN_SOURCE_SHA256) {
    throw new Error("FAULTPACT_SOURCE_SHA256 does not match the frozen source");
  }
  return parsed.data;
}

export function normalizeAddress(address: string): string {
  if (!ADDRESS_RE.test(address)) throw new Error(`Invalid address: ${address}`);
  return address.toLowerCase();
}

export function normalizeHash256(hash: string): string {
  const normalized = hash.toLowerCase().replace(/^0x/, "");
  if (!HASH256_RE.test(normalized)) throw new Error("Expected lowercase SHA-256 hex");
  return normalized;
}

export function asBigInt(value: unknown, field = "value"): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is not a safe integer`);
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`${field} is not an unsigned integer`);
}

export function bigintToString(value: unknown, field = "value"): string {
  return asBigInt(value, field).toString();
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function jsonSafe(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot serialize non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (typeof value === "object") {
    const record: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) record[key] = jsonSafe(item);
    return record;
  }
  throw new Error(`Unsupported JSON value type: ${typeof value}`);
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key] as JsonValue)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(jsonSafe(value)));
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256CanonicalJson(value: unknown): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  return { bytes, sha256: sha256Bytes(bytes) };
}

export function parsePage(value: unknown, defaultSize = 25, maxSize = 100): { cursor: number; limit: number } {
  const input = (value ?? {}) as { cursor?: unknown; limit?: unknown };
  const cursor = input.cursor === undefined ? 0 : Number(input.cursor);
  const limit = input.limit === undefined ? defaultSize : Number(input.limit);
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("cursor must be a non-negative integer");
  if (!Number.isInteger(limit) || limit < 1 || limit > maxSize) throw new Error(`limit must be 1..${maxSize}`);
  return { cursor, limit };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
