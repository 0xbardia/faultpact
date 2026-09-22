import { createHash } from "node:crypto";

const TYPE_PINT = 1;
const TYPE_NINT = 2;
const TYPE_BYTES = 3;
const TYPE_STR = 4;
const TYPE_ARR = 5;
const TYPE_MAP = 6;
const SPECIAL_NULL = 0;
const SPECIAL_FALSE = 8;
const SPECIAL_TRUE = 16;
const BITS_IN_TYPE = 3;

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

export type RpcTransport = {
  request(method: string, params?: readonly unknown[]): Promise<unknown>;
  readContract(address: string, method: string, args: readonly unknown[], from?: string): Promise<unknown>;
  getContractCode(address: string): Promise<string>;
  getContractSchema(address: string): Promise<unknown>;
};

function b64ToText(value: unknown): string {
  if (typeof value !== "string") throw new Error("GenLayer source response is not base64 text");
  return Buffer.from(value, "base64").toString("utf8");
}

export class StudioRpcTransport implements RpcTransport {
  private nextRequestId = 1;
  private lastRequestAt = 0;
  constructor(readonly rpcUrl: string) {}

  async request(method: string, params: readonly unknown[] = []): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < 250) await new Promise((resolve) => setTimeout(resolve, 250 - elapsed));
      const id = this.nextRequestId++;
      this.lastRequestAt = Date.now();
      const response = await fetch(this.rpcUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: AbortSignal.timeout(10_000) });
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "");
        if (Number.isFinite(retryAfter) && retryAfter > 30) throw new Error(`GenLayer RPC rate limit exceeded; retry after ${retryAfter} seconds`);
        const exponentialDelay = Math.min(10_000, 500 * 2 ** attempt);
        const serverDelay = Number.isFinite(retryAfter) ? Math.max(250, retryAfter * 1000) : 0;
        const jitter = Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, Math.max(exponentialDelay, serverDelay) + jitter)));
        continue;
      }
      if (!response.ok) throw new Error(`GenLayer RPC HTTP ${response.status}`);
      const payload = await response.json() as { result?: unknown; error?: { message?: string } };
      if (payload.error) throw new Error(`GenLayer RPC error (${method}): ${payload.error.message ?? "request failed"}`);
      return payload.result;
    }
    throw new Error(`GenLayer RPC rate limit persisted for ${method}`);
  }

  async readContract(address: string, method: string, args: readonly unknown[], from = "0x0000000000000000000000000000000000000000"): Promise<unknown> {
    const result = await this.request("gen_call", [{ type: "read", to: address, from, data: buildLegacyReadData(method, args), transaction_hash_variant: "latest-nonfinal" }]);
    if (typeof result === "string") return decodeLegacyReturn(result);
    const record = result && typeof result === "object" ? result as Record<string, unknown> : undefined;
    if (!record || typeof record.data !== "string") throw new Error("GenLayer read returned no data");
    if (record.status && typeof record.status === "object" && (record.status as Record<string, unknown>).code !== 0) throw new Error(`GenLayer read failed: ${String((record.status as Record<string, unknown>).message ?? "execution failed")}`);
    return decodeLegacyReturn(record.data);
  }

  async getContractCode(address: string): Promise<string> { return b64ToText(await this.request("gen_getContractCode", [address])); }
  async getContractSchema(address: string): Promise<unknown> { return await this.request("gen_getContractSchema", [address]); }
}

export function sourceSha256(source: string): string { return createHash("sha256").update(Buffer.from(source, "utf8")).digest("hex"); }
