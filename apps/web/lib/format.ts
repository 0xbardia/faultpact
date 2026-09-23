import { text, type JsonRecord } from "./api";

export function rowValue(row: JsonRecord | undefined, key: string, fallback = "—"): string {
  return text(row?.[key], fallback);
}

export function formatId(value: unknown): string {
  return text(value, "—");
}

export function formatAddress(value: unknown): string {
  const address = text(value, "");
  return /^0x[a-fA-F0-9]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address || "—";
}

export function formatHash(value: unknown): string {
  const hash = text(value, "");
  return /^[a-fA-F0-9]{64}$/.test(hash) ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash || "—";
}

function digits(value: unknown): bigint | null {
  const raw = text(value, "");
  return /^\d+$/.test(raw) ? BigInt(raw) : null;
}

export function formatGen(value: unknown): string {
  const amount = digits(value);
  if (amount === null) return text(value);
  const whole = amount / 1_000_000_000_000_000_000n;
  const fraction = (amount % 1_000_000_000_000_000_000n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ""} GEN`;
}

export function genDecimal(value: unknown): string {
  const amount = digits(value);
  if (amount === null) return "";
  const whole = amount / 1_000_000_000_000_000_000n;
  const fraction = (amount % 1_000_000_000_000_000_000n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export function parseGen(value: string): bigint | null {
  if (!/^\d+(?:\.\d{0,18})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  try { return BigInt(whole ?? "0") * 1_000_000_000_000_000_000n + BigInt((fraction + "0".repeat(18)).slice(0, 18)); }
  catch { return null; }
}

export function formatDurationSeconds(value: unknown): string {
  const seconds = digits(value);
  if (seconds === null) return text(value);
  if (seconds >= 86_400n && seconds % 86_400n === 0n) return `${seconds / 86_400n} days`;
  if (seconds >= 3_600n && seconds % 3_600n === 0n) return `${seconds / 3_600n} hours`;
  if (seconds >= 60n && seconds % 60n === 0n) return `${seconds / 60n} min`;
  return `${seconds} sec`;
}

export function formatPpm(value: unknown, suffix = "%"): string {
  const ppm = digits(value);
  if (ppm === null) return text(value);
  const whole = ppm / 10_000n;
  const fraction = (ppm % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return `${whole.toString()}${fraction ? `.${fraction}` : ""}${suffix}`;
}

export function formatPpmAsPercentage(value: unknown): string {
  return formatPpm(value);
}

export function formatBpsAsPercentage(value: unknown): string {
  const bps = digits(value);
  if (bps === null) return text(value);
  const whole = bps / 100n;
  const fraction = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

export function formatUnixSeconds(value: unknown): string {
  const seconds = digits(value);
  if (seconds === null || seconds > 8_640_000_000_000n) return text(value);
  return formatDate(new Date(Number(seconds * 1000n)).toISOString());
}

export function formatDate(value: unknown): string {
  const raw = text(value, "");
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? raw : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function relativeTime(value: unknown): string {
  const raw = text(value, "");
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.valueOf())) return "Unknown freshness";
  const seconds = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function statusTone(value: unknown): "good" | "warn" | "bad" | "neutral" {
  const status = text(value, "").toUpperCase();
  if (["FINALIZED", "SETTLED", "ACTIVE", "HEALTHY", "ELIGIBLE", "PUBLISHED", "OPEN"].includes(status)) return "good";
  if (["PENDING", "PROCESSING", "EVIDENCE", "CHALLENGEABLE", "DEGRADED", "SUSPECTED", "RECOVERING"].includes(status)) return "warn";
  if (["FAILED", "INELIGIBLE", "INCONCLUSIVE", "RETIRED", "PAUSED", "UNAVAILABLE", "STALE"].includes(status)) return "bad";
  return "neutral";
}

export function statusLabel(value: unknown): string {
  return text(value, "UNKNOWN").replaceAll("_", " ");
}

export function initials(value: unknown): string {
  const source = text(value, "FP").replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "FP";
}
