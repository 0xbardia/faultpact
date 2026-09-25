import { describe, expect, it, vi } from "vitest";
import { buildConsensusCallData, getStudioFeePreset, sendFaultPactTransaction, switchToFaultPact, waitForGenLayerFinalization, walletErrorDetails, walletErrorMessage, type StudioFeePreset } from "./wallet";

const address = "0x1111111111111111111111111111111111111111";
const feePreset: StudioFeePreset = { feeValue: 100n, distribution: { leaderTimeunitsAllocation: 1n, validatorTimeunitsAllocation: 2n, appealRounds: 0n, executionBudgetPerRound: 3n, executionConsumed: 0n, totalMessageFees: 0n, rotations: [0n], maxPriceGenPerTimeUnit: 2n, storageFeeMaxGasPrice: 3n, receiptFeeMaxGasPrice: 3n } };

describe("frozen-schema browser wallet adapter", () => {
  it("encodes a supported Provider registration action", () => {
    const data = buildConsensusCallData(address, "register_provider", ["Example Provider", "", ""], feePreset);
    expect(data).toMatch(/^0x[0-9a-f]{8}/i);
    expect(data).not.toMatch(/^0x27241a99/i);
    expect(data.toLowerCase()).toContain("eb858957e3c426597245f6b59e260f1cc556bf13");
  });

  it("rejects unknown methods and Number values for contract integers", () => {
    expect(() => buildConsensusCallData(address, "made_up_method", [], feePreset)).toThrow(/frozen contract schema/);
    expect(() => buildConsensusCallData(address, "allocate_capital", [1n, 2], feePreset)).toThrow(/integer precision/);
  });

  it("reads the current Studio fee deposit and preserves uint precision", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { enabled: true, defaultFees: { feeValue: "76548000002588", distribution: { leaderTimeunitsAllocation: "100", validatorTimeunitsAllocation: "200", appealRounds: "0", executionBudgetPerRound: "76548000000000", executionConsumed: "0", totalMessageFees: "0", rotations: ["0"], maxPriceGenPerTimeUnit: "2", storageFeeMaxGasPrice: "300000000", receiptFeeMaxGasPrice: "300000000" } } } })));
    vi.stubGlobal("fetch", fetch);
    try {
      const fees = await getStudioFeePreset();
      expect(fees.feeValue).toBe(153096000002588n);
      expect(fees.distribution.executionBudgetPerRound).toBe(153096000000000n);
      expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject({ method: "sim_getFeeConfig", params: [] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("includes the protocol fee deposit with payable Provider capital", async () => {
    const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
      if (method === "eth_accounts") return [address];
      if (method === "eth_chainId") return "0xf22d";
      if (method === "eth_gasPrice") return "0x0";
      if (method === "eth_estimateGas") return "0x100000";
      if (method === "eth_sendTransaction") return "0xtransaction";
      throw new Error(`Unexpected method ${method}`);
    });
    vi.stubGlobal("window", { ethereum: { request } });
    try {
      await expect(sendFaultPactTransaction("deposit_capital", [1n], 500n, address, feePreset)).resolves.toBe("0xtransaction");
      const send = request.mock.calls.find(([call]) => call.method === "eth_sendTransaction")?.[0];
      const sentTransaction = send?.params?.[0] as { value: string; chainId: string; data: string };
      expect(sentTransaction).toMatchObject({ value: "0x258", chainId: "0xf22d" });
      expect(sentTransaction.data).not.toMatch(/^0x27241a99/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("turns wallet rejection into customer language", () => {
    expect(walletErrorMessage({ code: 4001, message: "User rejected" })).toBe("You declined the wallet request. No transaction was submitted.");
  });

  it("maps string wallet codes and nested provider messages", () => {
    expect(walletErrorMessage({ code: "4902", message: "Unknown chain" })).toContain("Chain 61997");
    expect(walletErrorMessage({ code: -32603, message: 'Unrecognized chain ID "0xf22d"' })).toContain("Chain 61997");
    expect(walletErrorMessage({ code: -32602, data: { message: "RPC URL is invalid" } })).toContain("could not complete");
    expect(walletErrorDetails({ code: -32602, data: { message: "RPC URL is invalid" } })).toContain("RPC URL is invalid");
  });

  it("adds then switches to Studio Dev when Rabby reports an unrecognized chain", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce({ code: -32603, message: 'Unrecognized chain ID "0xf22d"' })
      .mockResolvedValue(undefined);
    vi.stubGlobal("window", { ethereum: { request } });
    try {
      await switchToFaultPact();
      expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: "wallet_addEthereumChain" }));
      expect(request).toHaveBeenNthCalledWith(3, { method: "wallet_switchEthereumChain", params: [{ chainId: "0xf22d" }] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("polls GenLayer consensus status and waits for FINALIZED", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { status: "Accepted", statusCode: 5 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { status: "Finalized", statusCode: 7 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { txExecutionResult: 1, txExecutionResultName: "FINISHED_WITH_RETURN" } })));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const updates: string[] = [];
      const state = await waitForGenLayerFinalization("0xabc", (update) => updates.push(update.status), { intervalMs: 0, attempts: 2 });
      expect(state.status).toBe("FINALIZED");
      expect(state.result).toBe("FINISHED_WITH_RETURN");
      expect(updates).toEqual(["ACCEPTED", "FINALIZED"]);
      expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject({ method: "gen_getTransactionStatus", params: [{ txId: "0xabc" }] });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("backs off on Studio quota responses without treating them as final", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: -32029, message: "Rate limit exceeded", data: { retry_after_seconds: 0 } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { status: "Finalized", statusCode: 7 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { txExecutionResultName: "FINISHED_WITH_RETURN" } })));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const updates: Array<{ status: string; raw: Record<string, unknown> }> = [];
      const state = await waitForGenLayerFinalization("0xabc", (update) => updates.push(update), { intervalMs: 0, attempts: 2 });
      expect(state.status).toBe("FINALIZED");
      expect(updates[0]).toMatchObject({ status: "RPC_DEGRADED", raw: { message: "Studio is rate limiting transaction status checks.", retryAfterMs: 0 } });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("detects an EVM-reverted submission instead of leaving it pending", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: -32001, message: "Transaction 0xabc not found" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { status: "0x0", revertReason: "FeesDistributionMissing" } })));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await expect(waitForGenLayerFinalization("0xabc", undefined, { intervalMs: 0, attempts: 1 })).rejects.toThrow(/FeesDistributionMissing/);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("does not treat a finalized failed execution as a successful action", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { status: "Finalized", statusCode: 7 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { txExecutionResult: 2, txExecutionResultName: "FINISHED_WITH_ERROR" } })));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(waitForGenLayerFinalization("0xabc", undefined, { intervalMs: 0, attempts: 1 })).rejects.toThrow(/action failed\. No contract state changed/);
      expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toMatchObject({ method: "eth_getTransactionByHash", params: ["0xabc"] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
