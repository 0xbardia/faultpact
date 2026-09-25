import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildLegacyCalldata, buildLegacyReadData, calldataAddress, CalldataAddress, decodeLegacyReturn } from "./rpc.js";
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
  it("ENCODES_ADDRESS_PARAMETERS_AS_20_BYTE_VALUES", () => {
    const address = "0x99FF79513004dB21546a0c1b419f48ae30760580";
    const encoded = calldataAddress(address);
    expect(encoded.toString()).toBe(address.toLowerCase());
    expect(calldataAddress(address).bytes).toHaveLength(20);
    // The address special value (24) precedes the raw 20 bytes, not a UTF-8 string.
    const legacy = Buffer.from(buildLegacyCalldata("is_authorized_reporter", [encoded]));
    const addressBytes = Buffer.from(address.slice(2).toLowerCase(), "hex");
    const offset = legacy.indexOf(addressBytes);
    expect(offset).toBeGreaterThan(0);
    expect(legacy[offset - 1]).toBe(24);
    expect(legacy.includes(Buffer.from(address, "utf8"))).toBe(false);
    // A u256 argument keeps the integer encoding: it round-trips as a bigint.
    const incidentCall = Buffer.from(buildLegacyCalldata("get_incident", [12n])).toString("hex");
    expect(decodeLegacyReturn(`0x${incidentCall}`)).toEqual({ "": "get_incident", args: [12n] });
    expect(() => calldataAddress("0x1234")).toThrow(/20-byte/);
  });
  it("MAPS_ADDRESS_SCHEMA_PARAMETERS_THROUGH_THE_ADAPTER", async () => {
    const calls: Array<{ method: string; args: readonly unknown[] }> = [];
    const adapter = new FaultPactContractAdapter({
      request: async () => null,
      readContract: async (_address, method, args) => { calls.push({ method, args }); return method === "is_authorized_reporter" ? true : [1n, 2n]; },
      getContractCode: async () => "",
      getContractSchema: async () => null,
    });
    expect(await adapter.isAuthorizedReporter("0x99FF79513004dB21546a0c1b419f48ae30760580")).toBe(true);
    expect(calls[0]?.method).toBe("is_authorized_reporter");
    expect(calls[0]?.args[0]).toBeInstanceOf(CalldataAddress);
    // u256 and string parameters are untouched.
    await adapter.getIncidentEvidenceIds(7n);
    expect(calls[1]?.args[0]).toBe(7n);
    // The address calldata round-trips back to a 0x-prefixed string.
    const [method, args] = [calls[0]!.method, calls[0]!.args];
    expect(decodeLegacyReturn(`0x${Buffer.from(buildLegacyCalldata(method, args)).toString("hex")}`)).toEqual({ "": "is_authorized_reporter", args: ["0x99ff79513004db21546a0c1b419f48ae30760580"] });
  });
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
  it("RAW_RPC_METHODS_ARE_READ_ONLY_ALLOWLISTED", async () => {
    const adapter = new FaultPactContractAdapter({ request: async () => null, readContract: async () => null, getContractCode: async () => "", getContractSchema: async () => null });
    await expect(adapter.rpcRequest("eth_sendTransaction", [])).rejects.toThrow(/not allowlisted/);
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
