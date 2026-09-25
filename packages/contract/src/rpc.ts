import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const TYPE_PINT = 1;
const TYPE_NINT = 2;
const TYPE_BYTES = 3;
const TYPE_STR = 4;
const TYPE_ARR = 5;
const TYPE_MAP = 6;
const SPECIAL_NULL = 0;
const SPECIAL_FALSE = 8;
const SPECIAL_TRUE = 16;
const SPECIAL_ADDR = 24;
const ADDRESS_BYTES = 20;
const BITS_IN_TYPE = 3;

/** A 20-byte contract address argument. Address-typed parameters are not plain strings. */
export class CalldataAddress {
  constructor(readonly bytes: Uint8Array) {
    if (bytes.byteLength !== ADDRESS_BYTES) throw new Error("contract address must be 20 bytes");
  }

  toString(): string {
    return `0x${Buffer.from(this.bytes).toString("hex")}`;
  }
}

export function calldataAddress(value: string | { toString(): string }): CalldataAddress {
  const text = typeof value === "string" ? value : value.toString();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) throw new Error("contract address must be 0x-prefixed 20-byte hex");
  return new CalldataAddress(Uint8Array.from(Buffer.from(text.slice(2), "hex")));
}

function writeUleb(out: number[], value: bigint): void {
  if (value === 0n) { out.push(0); return; }
  let remaining = value;
  while (remaining > 0n) {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    out.push(byte);
  }
}

function encodeNumber(out: number[], value: bigint, type: number): void { writeUleb(out, (value << BigInt(BITS_IN_TYPE)) | BigInt(type)); }

function compareCodepoints(left: number[], right: number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function encodeValue(out: number[], value: unknown): void {
  if (value === null || value === undefined) { out.push(SPECIAL_NULL); return; }
  if (value === false) { out.push(SPECIAL_FALSE); return; }
  if (value === true) { out.push(SPECIAL_TRUE); return; }
  if (value instanceof CalldataAddress) { out.push(SPECIAL_ADDR); out.push(...value.bytes); return; }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("calldata numbers must be safe integers");
    const integer = BigInt(value);
    encodeNumber(out, integer >= 0n ? integer : -integer - 1n, integer >= 0n ? TYPE_PINT : TYPE_NINT);
    return;
  }
  if (typeof value === "bigint") {
    encodeNumber(out, value >= 0n ? value : -value - 1n, value >= 0n ? TYPE_PINT : TYPE_NINT);
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    encodeNumber(out, BigInt(bytes.byteLength), TYPE_STR);
    out.push(...bytes);
    return;
  }
  if (value instanceof Uint8Array) {
    encodeNumber(out, BigInt(value.byteLength), TYPE_BYTES);
    out.push(...value);
    return;
  }
  if (Array.isArray(value)) {
    encodeNumber(out, BigInt(value.length), TYPE_ARR);
    for (const item of value) encodeValue(out, item);
    return;
  }
  if (value instanceof Map) {
    encodeMap(out, [...value.entries()].map(([key, item]) => [String(key), item]));
    return;
  }
  if (typeof value === "object") {
    encodeMap(out, Object.entries(value));
    return;
  }
  throw new Error(`unsupported calldata value: ${typeof value}`);
}

function encodeMap(out: number[], entries: Array<[string, unknown]>): void {
  const sorted = entries.map(([key, value]) => ({ key, value, bytes: new TextEncoder().encode(key), codepoints: [...key].map((char) => char.codePointAt(0) ?? 0) })).sort((left, right) => compareCodepoints(left.codepoints, right.codepoints));
  for (let index = 1; index < sorted.length; index += 1) if (compareCodepoints(sorted[index - 1]?.codepoints ?? [], sorted[index]?.codepoints ?? []) === 0) throw new Error("duplicate calldata map key");
  encodeNumber(out, BigInt(sorted.length), TYPE_MAP);
  for (const entry of sorted) { writeUleb(out, BigInt(entry.bytes.byteLength)); out.push(...entry.bytes); encodeValue(out, entry.value); }
}

export function buildLegacyCalldata(method: string, args: readonly unknown[]): Uint8Array {
  const out: number[] = [];
  encodeValue(out, { "": method, ...(args.length ? { args: [...args] } : {}) });
  return Uint8Array.from(out);
}

function hex(bytes: Uint8Array): string { return `0x${Buffer.from(bytes).toString("hex")}`; }

function rlpBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && (bytes[0] ?? 0) < 0x80) return bytes;
  if (bytes.length < 56) return Uint8Array.from([0x80 + bytes.length, ...bytes]);
  const length = Buffer.from(bytes).toString("hex");
  const lengthBytes = Buffer.from(length.length % 2 ? `0${length}` : length, "hex");
  return Uint8Array.from([0xb7 + lengthBytes.length, ...lengthBytes, ...bytes]);
}

function rlpList(items: Uint8Array[]): Uint8Array {
  const payload = Uint8Array.from(items.flatMap((item) => [...rlpBytes(item)]));
  if (payload.length < 56) return Uint8Array.from([0xc0 + payload.length, ...payload]);
  const length = Buffer.from(payload).toString("hex");
  const lengthBytes = Buffer.from(length.length % 2 ? `0${length}` : length, "hex");
  return Uint8Array.from([0xf7 + lengthBytes.length, ...lengthBytes, ...payload]);
}

export function buildLegacyReadData(method: string, args: readonly unknown[]): string {
  return hex(rlpList([buildLegacyCalldata(method, args), Uint8Array.from([0])]));
}

function readUleb(bytes: Uint8Array, state: { index: number }): bigint {
  let result = 0n;
  let shift = 0n;
  while (state.index < bytes.length) {
    const byte = bytes[state.index++] ?? 0;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7n;
  }
  throw new Error("truncated GenLayer calldata result");
}

function decodeValue(bytes: Uint8Array, state: { index: number }): unknown {
  const marker = readUleb(bytes, state);
  if (marker === BigInt(SPECIAL_NULL)) return null;
  if (marker === BigInt(SPECIAL_FALSE)) return false;
  if (marker === BigInt(SPECIAL_TRUE)) return true;
  if (marker === BigInt(SPECIAL_ADDR)) {
    const addressBytes = bytes.slice(state.index, state.index + ADDRESS_BYTES);
    state.index += ADDRESS_BYTES;
    return `0x${Buffer.from(addressBytes).toString("hex")}`;
  }
  const type = Number(marker & 7n);
  const lengthValue = marker >> BigInt(BITS_IN_TYPE);
  if (type === TYPE_PINT) return lengthValue;
  if (type === TYPE_NINT) return -1n - lengthValue;
  if (lengthValue > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("GenLayer return length exceeds safe bounds");
  const length = Number(lengthValue);
  if (type === TYPE_BYTES || type === TYPE_STR) {
    const value = bytes.slice(state.index, state.index + length);
    state.index += length;
    return type === TYPE_STR ? new TextDecoder().decode(value) : value;
  }
  if (type === TYPE_ARR) return Array.from({ length }, () => decodeValue(bytes, state));
  if (type === TYPE_MAP) {
    const object: Record<string, unknown> = {};
    for (let index = 0; index < length; index += 1) {
      const keyLength = Number(readUleb(bytes, state));
      const key = new TextDecoder().decode(bytes.slice(state.index, state.index + keyLength));
      state.index += keyLength;
      object[key] = decodeValue(bytes, state);
    }
    return object;
  }
  throw new Error(`unsupported GenLayer calldata result type ${type}`);
}

export function decodeLegacyReturn(rawHex: string): unknown {
  const value = rawHex.replace(/^0x/, "");
  if (!/^[0-9a-f]*$/i.test(value) || value.length % 2 !== 0) throw new Error("invalid GenLayer return data");
  const bytes = Buffer.from(value, "hex");
  const result = decodeValue(bytes, { index: 0 });
  return result;
}

export type RpcRequestOptions = { subsystem?: string };

export type RpcTransport = {
  request(method: string, params?: readonly unknown[], options?: RpcRequestOptions): Promise<unknown>;
  readContract(address: string, method: string, args: readonly unknown[], from?: string, options?: RpcRequestOptions): Promise<unknown>;
  getContractCode(address: string, options?: RpcRequestOptions): Promise<string>;
  getContractSchema(address: string, options?: RpcRequestOptions): Promise<unknown>;
};

export type RpcTransportOptions = {
  minIntervalMs?: number;
  dailyBudget?: number;
  budgetStateFile?: string;
  maxRetries?: number;
  requestTimeoutMs?: number;
  now?: () => number;
  random?: () => number;
};

export type RpcMetricBreakdown = {
  attempted: number;
  actuallySent: number;
  successful: number;
  http429: number;
  jsonRpcRateLimits: number;
  http5xx: number;
  transportErrors: number;
  jsonRpcErrors: number;
  retries: number;
  locallySuppressed: number;
  cooldownRejected: number;
  budgetRejected: number;
  schedulerRejected: number;
  deduplicated: number;
};

export type RpcMetrics = RpcMetricBreakdown & {
  minIntervalMs: number;
  dailyBudget: number;
  budgetDay: string;
  budgetCount: number;
  sharedState: boolean;
  cooldownUntil: number;
  byMethod: Record<string, RpcMetricBreakdown>;
  bySubsystem: Record<string, RpcMetricBreakdown>;
};

type SchedulerState = {
  version: 1;
  day: string;
  count: number;
  cooldownUntil: number;
  nextRequestAt: number;
  leaseId: string;
  leaseUntil: number;
  updatedAt: number;
};

type Reservation =
  | { ok: true; waitMs: number; leaseId: string }
  | { ok: false; reason: "cooldown" | "budget"; retryAt: number };

type AttemptResult =
  | { ok: true; value: unknown }
  | { ok: false; error: Error; retryable: boolean; cooldownUntil?: number };

function emptyBreakdown(): RpcMetricBreakdown {
  return { attempted: 0, actuallySent: 0, successful: 0, http429: 0, jsonRpcRateLimits: 0, http5xx: 0, transportErrors: 0, jsonRpcErrors: 0, retries: 0, locallySuppressed: 0, cooldownRejected: 0, budgetRejected: 0, schedulerRejected: 0, deduplicated: 0 };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function nextUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function temporaryHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504;
}

function numericEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function b64ToText(value: unknown): string {
  if (typeof value !== "string") throw new Error("GenLayer source response is not base64 text");
  return Buffer.from(value, "base64").toString("utf8");
}

export class StudioRpcTransport implements RpcTransport {
  private nextRequestId = 1;
  private nextRequestAt = 0;
  private blockedUntil = 0;
  private rateLimitCount = 0;
  private requestQueue: Promise<void> = Promise.resolve();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private budgetDay = "";
  private budgetCount = 0;
  private leaseSequence = 0;
  private readonly metrics: RpcMetrics;
  private readonly minIntervalMs: number;
  private readonly dailyBudget: number;
  private readonly budgetStateFile?: string;
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(readonly rpcUrl: string, options: RpcTransportOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? numericEnv("GENLAYER_RPC_MIN_INTERVAL_MS") ?? 3_000;
    this.dailyBudget = options.dailyBudget ?? numericEnv("GENLAYER_RPC_DAILY_BUDGET") ?? 1_400;
    const productionStateFile = process.env.NODE_ENV === "production" ? resolve(process.cwd(), ".runtime/studio-rpc-scheduler.json") : undefined;
    this.budgetStateFile = options.budgetStateFile ?? process.env.GENLAYER_RPC_BUDGET_STATE_FILE ?? productionStateFile;
    this.maxRetries = options.maxRetries ?? 2;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.metrics = { ...emptyBreakdown(), http5xx: 0, transportErrors: 0, minIntervalMs: this.minIntervalMs, dailyBudget: this.dailyBudget, budgetDay: "", budgetCount: 0, sharedState: this.budgetStateFile !== undefined, cooldownUntil: 0, byMethod: {}, bySubsystem: {} };
    if (!Number.isInteger(this.minIntervalMs) || this.minIntervalMs < 0) throw new Error("RPC minimum interval must be a non-negative integer");
    if (!Number.isInteger(this.dailyBudget) || this.dailyBudget < 1) throw new Error("RPC daily budget must be a positive integer");
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 5) throw new Error("RPC max retries must be an integer from 0 to 5");
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 100) throw new Error("RPC request timeout must be at least 100ms");
  }

  cooldownUntil(): number { return this.blockedUntil; }

  metricsSnapshot(): RpcMetrics {
    const cloneBreakdowns = (values: Record<string, RpcMetricBreakdown>) => Object.fromEntries(Object.entries(values).map(([key, metric]) => [key, { ...metric }]));
    return {
      ...this.metrics,
      budgetDay: this.budgetDay,
      budgetCount: this.budgetCount,
      cooldownUntil: this.blockedUntil,
      byMethod: cloneBreakdowns(this.metrics.byMethod),
      bySubsystem: cloneBreakdowns(this.metrics.bySubsystem),
    };
  }

  async refreshSchedulerState(): Promise<RpcMetrics> {
    if (!this.budgetStateFile) return this.metricsSnapshot();
    const state = await this.readSharedState();
    if (!state) return this.metricsSnapshot();
    this.budgetDay = state.day;
    this.budgetCount = state.count;
    this.blockedUntil = Math.max(this.blockedUntil, state.cooldownUntil);
    this.nextRequestAt = Math.max(this.nextRequestAt, state.nextRequestAt);
    return this.metricsSnapshot();
  }

  async request(method: string, params: readonly unknown[] = [], options: RpcRequestOptions = {}): Promise<unknown> {
    const subsystem = options.subsystem?.trim() || "contract";
    const methodMetrics = this.metrics.byMethod[method] ??= emptyBreakdown();
    const subsystemMetrics = this.metrics.bySubsystem[subsystem] ??= emptyBreakdown();
    this.metrics.attempted += 1;
    methodMetrics.attempted += 1;
    subsystemMetrics.attempted += 1;
    const key = `${method}:${JSON.stringify(params)}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      this.metrics.deduplicated += 1;
      methodMetrics.deduplicated += 1;
      subsystemMetrics.deduplicated += 1;
      return existing;
    }
    const pending = this.queuedRequest(method, params, subsystem);
    this.inFlight.set(key, pending);
    try { return await pending; }
    finally { if (this.inFlight.get(key) === pending) this.inFlight.delete(key); }
  }

  private queuedRequest(method: string, params: readonly unknown[], subsystem: string): Promise<unknown> {
    const pending = this.requestQueue.then(() => this.performRequest(method, params, subsystem));
    this.requestQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async performRequest(method: string, params: readonly unknown[], subsystem: string): Promise<unknown> {
    const maxAttempts = this.maxRetries + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const localRejection = this.localRejectionReason();
      if (localRejection) {
        this.recordSuppression(method, subsystem, localRejection.reason);
        throw new Error(localRejection.message);
      }
      let reservation: Reservation;
      try { reservation = await this.waitForReservation(); }
      catch (error) {
        this.recordSuppression(method, subsystem, "scheduler");
        throw error;
      }
      if (!reservation.ok) {
        this.recordSuppression(method, subsystem, reservation.reason);
        throw new Error(reservation.reason === "budget"
          ? `GenLayer RPC local daily budget exhausted; retry after ${Math.ceil((reservation.retryAt - this.now()) / 1000)} seconds`
          : `GenLayer RPC cooldown; retry after ${Math.ceil((reservation.retryAt - this.now()) / 1000)} seconds`);
      }
      if (reservation.waitMs > 0) await sleepMs(reservation.waitMs);
      const result = await this.sendOnce(method, params, subsystem, reservation.leaseId);
      const cooldownUntil = "cooldownUntil" in result ? result.cooldownUntil : undefined;
      await this.finishLease(reservation.leaseId, cooldownUntil);
      if (result.ok) return result.value;
      if (cooldownUntil !== undefined) {
        throw result.error;
      }
      if (result.retryable && attempt < maxAttempts - 1) {
        this.metrics.retries += 1;
        this.metrics.byMethod[method]!.retries += 1;
        this.metrics.bySubsystem[subsystem]!.retries += 1;
        const backoff = Math.min(30_000, 500 * 2 ** attempt) + Math.floor(this.random() * 250);
        await sleepMs(backoff);
        continue;
      }
      throw result.error;
    }
    throw new Error("unreachable Studio RPC retry state");
  }

  private localRejectionReason(): { reason: "cooldown" | "budget"; retryAt: number; message: string } | undefined {
    const now = this.now();
    if (now < this.blockedUntil) return { reason: "cooldown", retryAt: this.blockedUntil, message: `GenLayer RPC cooldown; retry after ${Math.ceil((this.blockedUntil - now) / 1000)} seconds` };
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.budgetDay !== day) {
      this.budgetDay = day;
      this.budgetCount = 0;
      return undefined;
    }
    if (this.budgetCount >= this.dailyBudget) {
      const retryAt = nextUtcDay(now);
      this.blockedUntil = Math.max(this.blockedUntil, retryAt);
      return { reason: "budget", retryAt, message: `GenLayer RPC local daily budget exhausted; retry after ${Math.ceil((retryAt - now) / 1000)} seconds` };
    }
    return undefined;
  }

  private recordSuppression(method: string, subsystem: string, reason: "cooldown" | "budget" | "scheduler"): void {
    this.metrics.locallySuppressed += 1;
    const methodMetrics = this.metrics.byMethod[method]!;
    const subsystemMetrics = this.metrics.bySubsystem[subsystem]!;
    methodMetrics.locallySuppressed += 1;
    subsystemMetrics.locallySuppressed += 1;
    if (reason === "cooldown") {
      this.metrics.cooldownRejected += 1;
      methodMetrics.cooldownRejected += 1;
      subsystemMetrics.cooldownRejected += 1;
    } else if (reason === "budget") {
      this.metrics.budgetRejected += 1;
      methodMetrics.budgetRejected += 1;
      subsystemMetrics.budgetRejected += 1;
    } else {
      this.metrics.schedulerRejected += 1;
      methodMetrics.schedulerRejected += 1;
      subsystemMetrics.schedulerRejected += 1;
    }
  }

  private async waitForReservation(): Promise<Reservation> {
    if (!this.budgetStateFile) return this.reserveLocal();
    while (true) {
      const now = this.now();
      let leaseWaitMs = 0;
      const reservation = await this.withStateLock(async (state) => {
        const currentDay = new Date(now).toISOString().slice(0, 10);
        if (state.day !== currentDay) state.count = 0;
        state.day = currentDay;
        if (state.cooldownUntil > now) {
          this.blockedUntil = Math.max(this.blockedUntil, state.cooldownUntil);
          return { ok: false, reason: "cooldown", retryAt: state.cooldownUntil } as Reservation;
        }
        if (state.count >= this.dailyBudget) {
          const retryAt = nextUtcDay(now) + 60_000;
          state.cooldownUntil = Math.max(state.cooldownUntil, retryAt);
          this.blockedUntil = Math.max(this.blockedUntil, retryAt);
          await this.writeSharedState(state);
          return { ok: false, reason: "budget", retryAt } as Reservation;
        }
        if (state.leaseUntil > now) {
          leaseWaitMs = state.leaseUntil - now;
          return undefined;
        }
        state.leaseId = "";
        state.leaseUntil = 0;
        const startAt = Math.max(now, state.nextRequestAt);
        const leaseId = `${process.pid}-${Date.now()}-${++this.leaseSequence}-${Math.floor(this.random() * 1_000_000_000)}`;
        state.leaseId = leaseId;
        state.leaseUntil = startAt + this.requestTimeoutMs + 5_000;
        state.nextRequestAt = startAt + this.minIntervalMs;
        state.count += 1;
        state.updatedAt = now;
        this.budgetDay = currentDay;
        this.budgetCount = state.count;
        this.nextRequestAt = state.nextRequestAt;
        await this.writeSharedState(state);
        return { ok: true, waitMs: Math.max(0, startAt - now), leaseId } as Reservation;
      });
      if (reservation) return reservation;
      await sleepMs(Math.max(25, Math.min(250, leaseWaitMs)));
    }
  }

  private reserveLocal(): Reservation {
    const now = this.now();
    const currentDay = new Date(now).toISOString().slice(0, 10);
    if (this.budgetDay !== currentDay) { this.budgetDay = currentDay; this.budgetCount = 0; }
    if (this.budgetCount >= this.dailyBudget) {
      const retryAt = nextUtcDay(now);
      this.blockedUntil = Math.max(this.blockedUntil, retryAt);
      return { ok: false, reason: "budget", retryAt };
    }
    const startAt = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = startAt + this.minIntervalMs;
    this.budgetCount += 1;
    return { ok: true, waitMs: Math.max(0, startAt - now), leaseId: "local" };
  }

  private async sendOnce(method: string, params: readonly unknown[], subsystem: string, leaseId: string): Promise<AttemptResult> {
    const id = this.nextRequestId++;
    this.metrics.actuallySent += 1;
    this.metrics.byMethod[method]!.actuallySent += 1;
    this.metrics.bySubsystem[subsystem]!.actuallySent += 1;
    let response: Response;
    try {
      response = await fetch(this.rpcUrl, { method: "POST", redirect: "error", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: AbortSignal.timeout(this.requestTimeoutMs) });
    } catch (error) {
      this.metrics.transportErrors += 1;
      this.metrics.byMethod[method]!.transportErrors += 1;
      this.metrics.bySubsystem[subsystem]!.transportErrors += 1;
      void leaseId;
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)), retryable: true };
    }
    const payload = await response.json().catch(() => undefined) as ({ jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } } & Record<string, unknown>) | undefined;
    const envelopeRecord = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : undefined;
    const hasResult = envelopeRecord ? Object.hasOwn(envelopeRecord, "result") : false;
    const hasError = envelopeRecord ? Object.hasOwn(envelopeRecord, "error") : false;
    const validEnvelope = envelopeRecord?.jsonrpc === "2.0" && envelopeRecord.id === id && hasResult !== hasError;
    const rpcError = validEnvelope && hasError ? envelopeRecord.error : undefined;
    const errorData = rpcError?.data && typeof rpcError.data === "object" ? rpcError.data as Record<string, unknown> : undefined;
    const errorMessage = typeof rpcError?.message === "string" ? rpcError.message : "";
    const rateLimited = response.status === 429 || Boolean(rpcError && (Number(rpcError.code) === -32029 || /\b429\b|rate limit|quota (?:exceeded|reached)/i.test(errorMessage)));
    if (rateLimited) {
      if (response.status === 429) {
        this.metrics.http429 += 1;
        this.metrics.byMethod[method]!.http429 += 1;
        this.metrics.bySubsystem[subsystem]!.http429 += 1;
      } else {
        this.metrics.jsonRpcRateLimits += 1;
        this.metrics.byMethod[method]!.jsonRpcRateLimits += 1;
        this.metrics.bySubsystem[subsystem]!.jsonRpcRateLimits += 1;
      }
      const now = this.now();
      const serverDelay = this.serverRetryDelay(response, errorData, now);
      const quotaText = `${errorMessage} ${JSON.stringify(errorData ?? {})}`;
      const dailyLimit = /requests?\s+per\s+day|daily\s+(?:limit|quota)/i.test(quotaText);
      const hourlyLimit = /requests?\s+per\s+hour|hourly\s+(?:limit|quota)/i.test(quotaText);
      const backoff = Math.min(60_000, 500 * 2 ** Math.min(this.rateLimitCount, 7));
      const fallback = dailyLimit ? nextUtcDay(now) - now + 60_000 : hourlyLimit ? 3_600_000 : backoff + Math.floor(this.random() * 250);
      const delay = Math.max(serverDelay, fallback);
      return { ok: false, error: new Error(`GenLayer RPC rate limited (${dailyLimit ? "daily" : hourlyLimit ? "hourly" : "request"} quota); retry after ${Math.ceil(delay / 1000)} seconds`), retryable: false, cooldownUntil: now + delay };
    }
    if (response.status >= 500) {
      this.metrics.http5xx += 1;
      this.metrics.byMethod[method]!.http5xx += 1;
      this.metrics.bySubsystem[subsystem]!.http5xx += 1;
    }
    if (!response.ok) return { ok: false, error: new Error(`GenLayer RPC HTTP ${response.status}`), retryable: temporaryHttpStatus(response.status) };
    if (!validEnvelope) {
      this.metrics.jsonRpcErrors += 1;
      this.metrics.byMethod[method]!.jsonRpcErrors += 1;
      this.metrics.bySubsystem[subsystem]!.jsonRpcErrors += 1;
      return { ok: false, error: new Error(`GenLayer RPC error (${method}): invalid JSON-RPC response envelope`), retryable: false };
    }
    if (rpcError) {
      this.metrics.jsonRpcErrors += 1;
      this.metrics.byMethod[method]!.jsonRpcErrors += 1;
      this.metrics.bySubsystem[subsystem]!.jsonRpcErrors += 1;
      return { ok: false, error: new Error(`GenLayer RPC error (${method}): ${errorMessage || "request failed"}`), retryable: false };
    }
    this.rateLimitCount = 0;
    this.metrics.successful += 1;
    this.metrics.byMethod[method]!.successful += 1;
    this.metrics.bySubsystem[subsystem]!.successful += 1;
    return { ok: true, value: envelopeRecord!.result };
  }

  private serverRetryDelay(response: Response, data: Record<string, unknown> | undefined, now: number): number {
    const header = response.headers.get("retry-after");
    const headerSeconds = header ? Number(header) : Number.NaN;
    const headerDate = header && !Number.isFinite(headerSeconds) ? Date.parse(header) : Number.NaN;
    const dataSeconds = Number(data?.retry_after_seconds ?? data?.retryAfterSeconds ?? data?.retry_after);
    const reset = Number(data?.reset_at ?? data?.resetAt ?? data?.reset);
    const resetDelay = Number.isFinite(reset) && reset > 0 ? (reset > 10_000_000_000 ? reset : reset * 1000) - now : 0;
    if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return headerSeconds * 1000;
    if (Number.isFinite(headerDate)) return Math.max(0, headerDate - now);
    if (Number.isFinite(dataSeconds) && dataSeconds >= 0) return dataSeconds * 1000;
    return Math.max(0, resetDelay);
  }

  private async finishLease(leaseId: string, cooldownUntil?: number): Promise<void> {
    if (cooldownUntil !== undefined) {
      this.blockedUntil = Math.max(this.blockedUntil, cooldownUntil);
      this.rateLimitCount += 1;
    }
    if (!this.budgetStateFile) return;
    try {
      await this.withStateLock(async (state) => {
        if (state.leaseId === leaseId) {
          state.leaseId = "";
          state.leaseUntil = 0;
        }
        if (cooldownUntil !== undefined) state.cooldownUntil = Math.max(state.cooldownUntil, cooldownUntil);
        state.updatedAt = this.now();
        await this.writeSharedState(state);
      });
    } catch {
      // The local cooldown still protects this process. A stale shared lease
      // expires automatically, so persistence failure never emits a request.
    }
  }

  private async readSharedState(): Promise<SchedulerState | undefined> {
    if (!this.budgetStateFile) return undefined;
    try {
      let parsed: Partial<SchedulerState>;
      try { parsed = JSON.parse(await readFile(this.budgetStateFile, "utf8")) as Partial<SchedulerState>; }
      catch (error: unknown) {
        if ((error as { code?: string }).code === "ENOENT") return undefined;
        throw new Error("invalid Studio RPC scheduler state", { cause: error });
      }
      if (parsed.version !== 1 || typeof parsed.day !== "string" || !Number.isSafeInteger(parsed.count) || Number(parsed.count) < 0 || !Number.isFinite(parsed.cooldownUntil) || !Number.isFinite(parsed.nextRequestAt) || typeof parsed.leaseId !== "string" || !Number.isFinite(parsed.leaseUntil)) throw new Error("invalid Studio RPC scheduler state");
      return parsed as SchedulerState;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "invalid Studio RPC scheduler state") throw error;
      throw new Error("invalid Studio RPC scheduler state", { cause: error });
    }
  }

  private async writeSharedState(state: SchedulerState): Promise<void> {
    if (!this.budgetStateFile) throw new Error("scheduler state file is not configured");
    const statePath = this.budgetStateFile;
    const temporaryPath = `${statePath}.${process.pid}.${Math.floor(this.random() * 1_000_000_000)}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state) + "\n", { mode: 0o600 });
    try { await rename(temporaryPath, statePath); }
    catch (error) { await unlink(temporaryPath).catch(() => undefined); throw error; }
  }

  private async withStateLock<T>(operation: (state: SchedulerState) => Promise<T>): Promise<T> {
    if (!this.budgetStateFile) throw new Error("scheduler state file is not configured");
    const statePath = this.budgetStateFile;
    const lockPath = `${statePath}.lock`;
    await mkdir(dirname(statePath), { recursive: true });
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      try { lock = await open(lockPath, "wx", 0o600); break; }
      catch (error: unknown) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        const lockStat = await stat(lockPath).catch(() => undefined);
        if (lockStat && this.now() - lockStat.mtimeMs > 30_000) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        await sleepMs(20);
      }
    }
    if (!lock) throw new Error("Studio RPC scheduler state lock is busy; no request was sent");
    try {
      const state = await this.readSharedState() ?? { version: 1, day: new Date(this.now()).toISOString().slice(0, 10), count: 0, cooldownUntil: 0, nextRequestAt: 0, leaseId: "", leaseUntil: 0, updatedAt: this.now() };
      return await operation(state);
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async readContract(address: string, method: string, args: readonly unknown[], from = "0x0000000000000000000000000000000000000000", options: RpcRequestOptions = {}): Promise<unknown> {
    const result = await this.request("gen_call", [{ type: "read", to: address, from, data: buildLegacyReadData(method, args), transaction_hash_variant: "latest-nonfinal" }], options);
    if (typeof result === "string") return decodeLegacyReturn(result);
    const record = result && typeof result === "object" ? result as Record<string, unknown> : undefined;
    if (!record || typeof record.data !== "string") throw new Error("GenLayer read returned no data");
    if (record.status && typeof record.status === "object" && (record.status as Record<string, unknown>).code !== 0) throw new Error(`GenLayer read failed: ${String((record.status as Record<string, unknown>).message ?? "execution failed")}`);
    return decodeLegacyReturn(record.data);
  }

  async getContractCode(address: string, options: RpcRequestOptions = {}): Promise<string> { return b64ToText(await this.request("gen_getContractCode", [address], options)); }
  async getContractSchema(address: string, options: RpcRequestOptions = {}): Promise<unknown> { return await this.request("gen_getContractSchema", [address], options); }
}

export function sourceSha256(source: string): string { return createHash("sha256").update(Buffer.from(source, "utf8")).digest("hex"); }
