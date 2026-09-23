import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioRpcTransport } from "./rpc.js";

afterEach(() => vi.unstubAllGlobals());

describe("Studio RPC transport", () => {
  it("deduplicates identical concurrent reads", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: 7 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new StudioRpcTransport("https://rpc.invalid");

    await expect(Promise.all([transport.request("gen_chainId"), transport.request("gen_chainId")])).resolves.toEqual([7, 7]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens a shared cooldown after HTTP 429", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new StudioRpcTransport("https://rpc.invalid");

    const results = await Promise.allSettled([transport.request("gen_call"), transport.request("gen_getContractCode")]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((results[1] as PromiseRejectedResult).reason)).toContain("cooldown");
  });
});
