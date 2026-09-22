export type JsonRecord = { [key: string]: unknown };

export type ApiEnvelope<T> = {
  data: T;
  source?: string;
  indexedAt?: string | null;
  pagination?: { cursor: number; limit: number; total: number; nextCursor: number | null };
  error?: string;
};

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1").replace(/\/$/, "");

export function apiUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${API_BASE}${normalized}`, "http://faultpact.local");
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
  const response = await fetch(apiUrl(path, params), { signal, headers: { Accept: "application/json" }, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as Partial<ApiEnvelope<T>> & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as ApiEnvelope<T>;
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function asRows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

export function text(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return fallback;
}
