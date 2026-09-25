import { describe, expect, it, vi } from "vitest";
import { MonitoringWorker } from "./monitor.js";

function monitorDb(targets: Array<Record<string, any>>, samples: Array<Record<string, any>> = []) {
  let heartbeat: Record<string, any> | undefined;
  const db = {
    probeSample: {
      deleteMany: async () => undefined,
      findMany: async () => samples.map((sample) => ({ ...sample })),
      findFirst: async () => samples.length ? { ...samples[samples.length - 1] } : null,
      create: async (args: any) => { samples.push(args.data); return args.data; },
    },
    monitorTarget: { findMany: async () => targets.map((target) => ({ ...target })) },
    workerHeartbeat: {
      upsert: async (args: any) => { heartbeat = { ...(heartbeat ?? {}), ...(args.create ?? {}), ...(args.update ?? {}) }; return heartbeat; },
    },
    metricAggregate: { upsert: async () => undefined },
    service: { findUnique: async () => null },
    incidentCandidate: { findFirst: async () => null, create: async () => undefined, update: async () => undefined },
    evidenceArtifact: { findUnique: async () => null, create: async () => undefined },
  };
  return { db: db as never, heartbeat: () => heartbeat, samples };
}

function studioTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    serviceId: null,
    name: "studio",
    endpointUrl: "https://studio-dev.genlayer.com/api",
    expectedChainId: 61997,
    region: "frankfurt",
    profile: {},
    enabled: true,
    intervalMs: 1_000,
    timeoutMs: 5_000,
    evidenceMode: "observe",
    ...overrides,
  };
}

const baseOptions = { region: "frankfurt", mode: "observe", timeoutMs: 5_000, maxResponseBytes: 262_144 };

describe("monitoring scheduler integration", () => {
  it("first Studio rate limit marks heartbeat degraded", async () => {
    let cooldownUntil = 0;
    const fake = monitorDb([studioTarget()]);
    const worker = new MonitoringWorker(fake.db, {
      ...baseOptions,
      genlayerProbeIntervalMs: 1_800_000,
      rpcCall: async () => { cooldownUntil = Date.now() + 60_000; throw new Error("GenLayer RPC rate limited; retry after 60 seconds"); },
      rpcCooldownUntil: () => cooldownUntil,
    });
    await worker.runOnce();
    expect(fake.samples[0]).toMatchObject({ success: false, errorCode: "HTTP_429" });
    expect(fake.heartbeat()).toMatchObject({ status: "DEGRADED", details: { cooldownUntil: expect.any(Number), schedulerErrors: 0 } });
  });

  it("canonical Studio URL variant cannot fall back to a direct client", async () => {
    const directFetch = vi.fn();
    vi.stubGlobal("fetch", directFetch);
    try {
      const fake = monitorDb([studioTarget({ endpointUrl: "https://studio-dev.genlayer.com:443/api/" })]);
      const worker = new MonitoringWorker(fake.db, { ...baseOptions, genlayerProbeIntervalMs: 1_800_000 });
      await worker.runOnce();
      expect(directFetch).not.toHaveBeenCalled();
      expect(fake.samples).toHaveLength(0);
      expect(fake.heartbeat()).toMatchObject({ status: "DEGRADED", details: { schedulerErrors: 1 } });
    } finally { vi.unstubAllGlobals(); }
  });

  it("scheduler state failure suspends probes without killing heartbeat", async () => {
    const fake = monitorDb([studioTarget()]);
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const worker = new MonitoringWorker(fake.db, { ...baseOptions, logger: logger as never, rpcCall: vi.fn(), rpcCooldownUntil: async () => { throw new Error("invalid Studio RPC scheduler state"); } });
    await worker.runOnce();
    expect(fake.samples).toHaveLength(0);
    expect(fake.heartbeat()).toMatchObject({ status: "DEGRADED" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("non-Studio monitoring cadence is preserved", async () => {
    const observedAt = new Date();
    const fake = monitorDb([{ ...studioTarget(), endpointUrl: "https://example.com/rpc", intervalMs: 30_000 }], [{ targetId: 1, observedAt, success: true, latencyMs: 10, referenceBlock: null, targetBlock: null }]);
    const rpcCall = vi.fn();
    const worker = new MonitoringWorker(fake.db, { ...baseOptions, rpcCall, rpcCooldownUntil: () => Date.now() + 60_000 });
    await worker.runOnce();
    expect(rpcCall).not.toHaveBeenCalled();
    expect(fake.samples).toHaveLength(1);
    expect(fake.heartbeat()).toMatchObject({ status: "HEALTHY" });
  });
});
