import { describe, expect, it } from "vitest";
import { createLiveAdapter } from "@faultpact/contract";

describe("frozen Studio Dev contract integration", () => {
  it("CONTRACT_SOURCE_SCHEMA_AND_CHAIN", async () => {
    const adapter = await createLiveAdapter();
    const verification = await adapter.verifyDeployment();
    expect(verification.chainId).toBe(61997);
    expect(verification.sourceSha256).toBe("4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e");
    expect(verification.sourceMatches).toBe(true);
    expect(verification.schemaMatchesSnapshot).toBe(true);
    expect(adapter.methodCount).toEqual({ methods: 78, views: 23, writes: 55, payables: 4 });
  }, 60000);
});
