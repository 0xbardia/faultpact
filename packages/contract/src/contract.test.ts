import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildLegacyReadData, decodeLegacyReturn } from "./rpc.js";
import { assertFrozenManifest, countSchemaMethods, FaultPactContractAdapter, getFrozenSchema, methodNames, schemaFingerprint } from "./index.js";

describe("frozen contract adapter", () => {
  it("CONTRACT_SCHEMA_DISCOVERY", () => {
    const counts = countSchemaMethods(getFrozenSchema());
    expect(counts).toEqual({ methods: 78, views: 23, writes: 55, payables: 4 });
    expect(methodNames(getFrozenSchema(), "view")).toContain("get_protocol_config");
  });
  it("CONTRACT_SOURCE_FINGERPRINT", () => expect(schemaFingerprint(getFrozenSchema())).toMatch(/^[a-f0-9]{64}$/));
  it("rejects the wrong frozen deployment", () => expect(() => assertFrozenManifest({ network: "x", chainId: 61999, rpc: "https://studio.genlayer.com/api", contractAddress: "0x0000000000000000000000000000000000000001", sourceSha256: "0".repeat(64) })).toThrow());
  it("uses the deployed legacy calldata shape", () => expect(buildLegacyReadData("get_counters", [])).toBe("0xd18f0e00646765745f636f756e7465727300"));
  it("DECODES_U256_WITHOUT_NUMBER_LOSS", () => {
    const value = 2n ** 70n;
    let marker = (value << 3n) | 1n;
    const encoded: number[] = [];
    do {
      let byte = Number(marker & 0x7fn);
      marker >>= 7n;
      if (marker > 0n) byte |= 0x80;
      encoded.push(byte);
    } while (marker > 0n);
    expect(decodeLegacyReturn(`0x${Buffer.from(encoded).toString("hex")}`)).toBe(value);
  });
  it("RUNTIME_VERIFICATION_CAN_USE_FROZEN_SCHEMA_SNAPSHOT", async () => {
    const source = await readFile(new URL("../../../contracts/FaultPact.py", import.meta.url));
    let schemaCalls = 0;
    const adapter = new FaultPactContractAdapter({
      request: async (method) => method === "eth_chainId" ? "0xf22d" : null,
      readContract: async () => null,
      getContractCode: async () => source.toString("utf8"),
      getContractSchema: async () => { schemaCalls += 1; return getFrozenSchema(); },
    });
    const verification = await adapter.verifyDeployment(source, { checkSchema: false });
    expect(verification.sourceMatches).toBe(true);
    expect(verification.schemaChecked).toBe(false);
    expect(verification.schemaMatchesSnapshot).toBe(false);
    expect(verification.schemaFingerprint).toBe(schemaFingerprint(getFrozenSchema()));
    expect(schemaCalls).toBe(0);
  });
});
