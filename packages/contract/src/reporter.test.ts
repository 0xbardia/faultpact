import { describe, expect, it } from "vitest";
import { StudioRpcBridge } from "./bridge.js";
import { assertReporterPrivateKeyFormat, createReporterWriter, deriveReporterAddress, ReporterConfigurationError } from "./reporter.js";
import { FROZEN_CHAIN_ID, FROZEN_RPC_URL, FROZEN_CONTRACT_ADDRESS } from "@faultpact/shared";
import type { RpcTransport } from "./rpc.js";

const TEST_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

function fakeTransport(overrides: Partial<RpcTransport> = {}): RpcTransport {
  return {
    request: async () => null,
    readContract: async () => null,
    getContractCode: async () => "",
    getContractSchema: async () => null,
    ...overrides,
  };
}

async function withBridge<T>(transport: RpcTransport, operation: (url: string) => Promise<T>): Promise<T> {
  const bridge = new StudioRpcBridge({ transport });
  const { url } = await bridge.start();
  try { return await operation(url); }
  finally { await bridge.close(); }
}

describe("studio RPC bridge", () => {
  it("PROXIES_JSON_RPC_TRAFFIC_THROUGH_THE_SHARED_TRANSPORT", async () => {
    const seen: Array<{ method: string; params: readonly unknown[]; subsystem?: string }> = [];
    const value = await withBridge(fakeTransport({ request: async (method, params = [], options) => { seen.push({ method, params, ...(options?.subsystem ? { subsystem: options.subsystem } : {}) }); return { ok: true }; } }), async (url) => {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "eth_chainId", params: [] }) });
      return await response.json() as { result: unknown };
    });
    expect(value.result).toEqual({ ok: true });
    expect(seen).toEqual([{ method: "eth_chainId", params: [], subsystem: "reporter_write" }]);
  });

  it("SURFACES_TRANSPORT_FAILURES_AS_JSON_RPC_ERRORS", async () => {
    const value = await withBridge(fakeTransport({ request: async () => { throw new Error("GenLayer RPC rate limited (request quota); retry after 42 seconds"); } }), async (url) => {
      const response = await fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x00"] }) });
      return await response.json() as { error: { message: string } };
    });
    expect(value.error.message).toContain("rate limited");
  });

  it("REJECTS_NON_POST_AND_MALFORMED_REQUESTS", async () => {
    await withBridge(fakeTransport(), async (url) => {
      expect((await fetch(url, { method: "GET" })).status).toBe(405);
      const malformed = await fetch(url, { method: "POST", body: "not json" });
      expect((await malformed.json() as { error: { code: number } }).error.code).toBe(-32700);
      const missingMethod = await fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1 }) });
      expect((await missingMethod.json() as { error: { code: number } }).error.code).toBe(-32600);
    });
  });

  it("BINDS_LOOPBACK_ONLY_AND_SERIALIZES_BIGINT_RESULTS", async () => {
    const bridge = new StudioRpcBridge({ transport: fakeTransport({ request: async (method) => (method === "eth_getTransactionCount" ? 12n : null) }) });
    const { url } = await bridge.start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: ["0xabc"] }) });
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: "12" });
    await bridge.close();
  });
});

describe("reporter signer", () => {
  it("DERIVES_THE_PUBLIC_ADDRESS_FROM_THE_PRIVATE_KEY", () => {
    const address = deriveReporterAddress(TEST_KEY);
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(deriveReporterAddress(TEST_KEY)).toBe(address);
    expect(deriveReporterAddress("0x2222222222222222222222222222222222222222222222222222222222222222")).not.toBe(address);
  });

  it("REJECTS_A_MISSING_OR_MALFORMED_PRIVATE_KEY", () => {
    expect(() => assertReporterPrivateKeyFormat("")).toThrow(ReporterConfigurationError);
    expect(() => assertReporterPrivateKeyFormat("0xnothex")).toThrow(/32-byte/);
    expect(() => deriveReporterAddress("")).toThrow(/REPORTER_PRIVATE_KEY/);
  });

  it("REFUSES_TO_SIGN_FOR_ANOTHER_CHAIN_OR_ENDPOINT", async () => {
    await expect(createReporterWriter({ privateKey: TEST_KEY, contractAddress: FROZEN_CONTRACT_ADDRESS, transport: fakeTransport(), chainId: 61_999 })).rejects.toThrow(/Refusing to sign for chain/);
    await expect(createReporterWriter({ privateKey: TEST_KEY, contractAddress: FROZEN_CONTRACT_ADDRESS, transport: fakeTransport(), rpcUrl: "https://studio.genlayer.com/api" })).rejects.toThrow(/Refusing to sign against/);
  });

  it("NEVER_PLACES_THE_PRIVATE_KEY_IN_AN_ERROR_MESSAGE", async () => {
    const writer = await createReporterWriter({
      privateKey: TEST_KEY,
      contractAddress: FROZEN_CONTRACT_ADDRESS,
      transport: fakeTransport({ request: async () => { throw new Error(`upstream rejected signature material ${TEST_KEY}`); } }),
    });
    expect(writer.address).toBe(deriveReporterAddress(TEST_KEY));
    let message = "";
    try { await writer.send({ method: "attach_incident_report", args: [1n, "s", "https://evidence.example/a.json", "a".repeat(64)] }); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toContain("<redacted>");
    expect(message).not.toContain(TEST_KEY);
    expect(message).not.toContain(TEST_KEY.slice(2));
    await writer.close();
  });

  it("SIGNS_THROUGH_THE_SDK_AND_RETURNS_THE_CONSENSUS_TRANSACTION_HASH", async () => {
    const seen: string[] = [];
    const consensusTxId = `0x${"9a".repeat(32)}`;
    const writer = await createReporterWriter({
      privateKey: TEST_KEY,
      contractAddress: FROZEN_CONTRACT_ADDRESS,
      transport: fakeTransport({
        request: async (method) => {
          seen.push(method);
          if (method === "eth_getTransactionCount") return "0x7";
          if (method === "eth_estimateGas") return "0x30d40";
          if (method === "eth_gasPrice") return "0x3b9aca00";
          if (method === "eth_sendRawTransaction") return `0x${"cd".repeat(32)}`;
          if (method === "eth_getTransactionReceipt") {
            return {
              transactionHash: `0x${"cd".repeat(32)}`,
              status: "0x1",
              logs: [{
                address: "0x0000000000000000000000000000000000000000",
                topics: ["0x8620e7f03a280a3d2aa84bd41ba19524c2d7f1dbfa9d79cb81877b0f8c963f9b", consensusTxId],
                data: `0x${"0".repeat(64)}`,
              }],
            };
          }
          return null;
        },
      }),
    });
    const result = await writer.send({ method: "attach_incident_report", args: [7n, "reporter", "https://evidence.example/a.json", "a".repeat(64)] });
    expect(result.txHash).toBe(consensusTxId);
    expect(result.sender).toBe(deriveReporterAddress(TEST_KEY));
    expect(result.recipient).toBe(FROZEN_CONTRACT_ADDRESS);
    expect(seen).toEqual(expect.arrayContaining(["eth_getTransactionCount", "eth_estimateGas", "eth_gasPrice", "eth_sendRawTransaction", "eth_getTransactionReceipt"]));
    await writer.close();
  });

  it("REFUSES_A_WRITE_WITHOUT_A_NEW_TRANSACTION_EVENT", async () => {
    const writer = await createReporterWriter({
      privateKey: TEST_KEY,
      contractAddress: FROZEN_CONTRACT_ADDRESS,
      transport: fakeTransport({
        request: async (method) => {
          if (method === "eth_getTransactionCount") return "0x0";
          if (method === "eth_estimateGas") return "0x5208";
          if (method === "eth_gasPrice") return "0x1";
          if (method === "eth_sendRawTransaction") return null;
          if (method === "eth_getTransactionReceipt") return { transactionHash: "0x00", status: "0x1", logs: [] };
          return null;
        },
      }),
    });
    await expect(writer.send({ method: "submit_evidence", args: [1n, "PROBE_REPORT", "https://evidence.example/a.json", "a".repeat(64), "d"] })).rejects.toThrow(/Reporter write submit_evidence failed/);
    await writer.close();
  });

  it("IS_PINNED_TO_THE_FROZEN_NETWORK", () => {
    expect(FROZEN_CHAIN_ID).toBe(61997);
    expect(FROZEN_RPC_URL).toBe("https://studio-dev.genlayer.com/api");
  });
});
