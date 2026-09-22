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

function rlpBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && (bytes[0] ?? 0) < 0x80) return bytes;
  if (bytes.length < 56) return Uint8Array.from([0x80 + bytes.length, ...bytes]);
  const lengthHex = bytes.length.toString(16);
  const normalizedLength = lengthHex.length % 2 ? `0${lengthHex}` : lengthHex;
  const lengthBytes = Uint8Array.from({ length: normalizedLength.length / 2 }, (_, index) => Number.parseInt(normalizedLength.slice(index * 2, index * 2 + 2), 16));
  return Uint8Array.from([0xb7 + lengthBytes.length, ...lengthBytes, ...bytes]);
}

function rlpList(items: Uint8Array[]): Uint8Array {
  const payload = Uint8Array.from(items.flatMap((item) => [...rlpBytes(item)]));
  if (payload.length < 56) return Uint8Array.from([0xc0 + payload.length, ...payload]);
  const lengthHex = payload.length.toString(16);
  const normalizedLength = lengthHex.length % 2 ? `0${lengthHex}` : lengthHex;
  const lengthBytes = Uint8Array.from({ length: normalizedLength.length / 2 }, (_, index) => Number.parseInt(normalizedLength.slice(index * 2, index * 2 + 2), 16));
  return Uint8Array.from([0xf7 + lengthBytes.length, ...lengthBytes, ...payload]);
}

export function buildLegacyReadData(method: string, args: readonly unknown[]): string {
  return `0x${Array.from(rlpList([buildLegacyCalldata(method, args), Uint8Array.from([0])]), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function buildLegacyTransactionData(method: string, args: readonly unknown[]): string {
  return buildLegacyReadData(method, args);
}
