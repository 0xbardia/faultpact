import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioRpcTransport } from "./rpc.js";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function mockSuccessfulFetch(fetchMock: ReturnType<typeof vi.fn>, result: unknown = 7): void {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id: number };
    return jsonResponse({ jsonrpc: "2.0", id: body.id, result });
  });
}

describe("Studio RPC scheduler", () => {
  it("RPC_SCHEDULER_SERIALIZES_AND_DEDUPLICATES_WHEN_REQUIRED", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      const body = JSON.parse(String(init.body)) as { id: number };
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: body.id });
    });
    vi.stubGlobal("fetch", fetchMock);
    const transport = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 10, dailyBudget: 10 });

    const results = await Promise.all([
      transport.request("eth_chainId", [], { subsystem: "monitor" }),
      transport.request("eth_chainId", [], { subsystem: "api_health" }),
      transport.request("eth_blockNumber", [], { subsystem: "monitor" }),
    ]);

    expect(results).toEqual([1, 1, 2]);
    expect(maxActive).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(transport.metricsSnapshot()).toMatchObject({ attempted: 3, actuallySent: 2, successful: 2, deduplicated: 1, byMethod: { eth_chainId: { attempted: 2, actuallySent: 1, deduplicated: 1 } } });
  });

  it("RPC_SCHEDULER_MIN_INTERVAL", async () => {
    const times: number[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      times.push(Date.now());
      const body = JSON.parse(String(init.body)) as { id: number };
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: body.id });
    });
    vi.stubGlobal("fetch", fetchMock);
    const transport = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 25, dailyBudget: 10 });

    await transport.request("eth_chainId");
    await transport.request("eth_blockNumber");
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(20);
  });

  it("RPC_429_RETRY_AFTER_ENTERS_COOLDOWN_AND_PERSISTS_ACROSS_PROCESSES", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const directory = await mkdtemp(`${tmpdir()}/faultpact-rpc-`);
    const statePath = `${directory}/scheduler.json`;
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id: number };
      return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32029, message: "Rate limit exceeded", data: { retry_after_seconds: 120 } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const first = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 10, budgetStateFile: statePath, now: () => now, random: () => 0 });
      await expect(first.request("gen_call", [], { subsystem: "indexer" })).rejects.toThrow(/retry after 120 seconds/);
      const restarted = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 10, budgetStateFile: statePath, now: () => now + 1_000 });
      await expect(restarted.request("eth_chainId", [], { subsystem: "api_health" })).rejects.toThrow(/cooldown/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(restarted.metricsSnapshot()).toMatchObject({ actuallySent: 0, cooldownRejected: 1, locallySuppressed: 1 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("RPC_DAILY_LIMIT_ENTERS_LONG_COOLDOWN", async () => {
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id: number };
      return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32029, message: "Daily quota reached: 5000 requests per day" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const transport = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 10, now: () => now, random: () => 0 });
    await expect(transport.request("gen_call")).rejects.toThrow(/daily quota/);
    expect(transport.cooldownUntil()).toBeGreaterThanOrEqual(Date.UTC(2026, 8, 25, 0, 1, 0));
  });

  it("RPC_429_LONG_RETRY_AFTER_IS_NOT_SHORTENED", async () => {
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "172800" } })));
    const transport = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 10, now: () => now, random: () => 0 });
    await expect(transport.request("eth_chainId")).rejects.toThrow(/retry after/);
    expect(transport.cooldownUntil() - now).toBe(172_800_000);
  });

  it("RPC_DAILY_BUDGET_STOPS_OUTBOUND_CALLS", async () => {
    const fetchMock = vi.fn();
    mockSuccessfulFetch(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    const transport = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 1 });
    await transport.request("eth_chainId");
    await expect(transport.request("eth_blockNumber")).rejects.toThrow(/local daily budget exhausted/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transport.metricsSnapshot()).toMatchObject({ actuallySent: 1, budgetRejected: 1, locallySuppressed: 1, bySubsystem: { contract: { budgetRejected: 1 } } });
  });

  it("PROCESS_RESTART_DOES_NOT_TRIGGER_UNBOUNDED_RPC_BURST", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const directory = await mkdtemp(`${tmpdir()}/faultpact-rpc-`);
    const statePath = `${directory}/scheduler.json`;
    const fetchMock = vi.fn();
    mockSuccessfulFetch(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    try {
      await new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 1, budgetStateFile: statePath }).request("eth_chainId");
      const restarted = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 1, budgetStateFile: statePath });
      await expect(restarted.request("eth_blockNumber")).rejects.toThrow(/local daily budget exhausted/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(statePath, "utf8"))).toMatchObject({ count: 1 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("shared scheduler serializes two transport instances", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const directory = await mkdtemp(`${tmpdir()}/faultpact-rpc-`);
    const statePath = `${directory}/scheduler.json`;
    let active = 0;
    let maxActive = 0;
    const starts: number[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      const body = JSON.parse(String(init.body)) as { id: number };
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: body.id });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const first = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 30, dailyBudget: 10, budgetStateFile: statePath });
      const second = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 30, dailyBudget: 10, budgetStateFile: statePath });
      await Promise.all([first.request("eth_chainId"), second.request("eth_blockNumber")]);
      expect(maxActive).toBe(1);
      expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(25);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("retries temporary HTTP failures with bounded metrics", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init.body)) as { id: number };
      if (calls === 1) return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "temporary" } }, { status: 503 });
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: "ok" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const transport = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 10, maxRetries: 2, random: () => 0 });
    await expect(transport.request("eth_chainId", [], { subsystem: "api_health" })).resolves.toBe("ok");
    expect(transport.metricsSnapshot()).toMatchObject({ actuallySent: 2, successful: 1, retries: 1, http5xx: 1, bySubsystem: { api_health: { retries: 1 } } });
  });

  it("rejects malformed JSON-RPC envelopes without counting success", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ result: 7 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 10 });
    await expect(transport.request("eth_chainId")).rejects.toThrow(/invalid JSON-RPC response envelope/);
    expect(transport.metricsSnapshot()).toMatchObject({ actuallySent: 1, successful: 0, jsonRpcErrors: 1 });
  });

  it("recovers a stale scheduler lock and fails closed on corrupt state", async () => {
    const { mkdtemp, rm, writeFile, utimes } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const directory = await mkdtemp(`${tmpdir()}/faultpact-rpc-`);
    const statePath = `${directory}/scheduler.json`;
    const lockPath = `${statePath}.lock`;
    const fetchMock = vi.fn();
    mockSuccessfulFetch(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    try {
      await writeFile(lockPath, "stale");
      const old = new Date(Date.now() - 60_000);
      await utimes(lockPath, old, old);
      await expect(new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 10, budgetStateFile: statePath }).request("eth_chainId")).resolves.toBe(7);
      await writeFile(statePath, "{not-json");
      await expect(new StudioRpcTransport("https://rpc.invalid", { minIntervalMs: 0, dailyBudget: 10, budgetStateFile: statePath }).request("eth_chainId")).rejects.toThrow(/invalid Studio RPC scheduler state/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
