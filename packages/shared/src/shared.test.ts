import { describe, expect, it } from "vitest";
import { asBigInt, canonicalJson, loadEnv, sha256Bytes } from "./index.js";

const baseEnv = {
  DATABASE_URL: "postgresql://root@localhost:5432/faultpact",
  FAULTPACT_CONTRACT_ADDRESS: "0xeb858957e3C426597245f6b59E260f1cC556Bf13",
  FAULTPACT_SOURCE_SHA256: "4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e",
};

describe("configuration and precision", () => {
  it("CONFIG_WRONG_CHAIN_REJECTED", () => expect(() => loadEnv({ ...baseEnv, GENLAYER_CHAIN_ID: "61999" })).toThrow(/61997/));
  it("CONFIG_WRONG_CONTRACT_REJECTED", () => expect(() => loadEnv({ ...baseEnv, FAULTPACT_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001" })).toThrow());
  it("U256_PRECISION_PRESERVED", () => expect(asBigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935").toString()).toHaveLength(78));
  it("canonical JSON is key-order stable", () => expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}'));
  it("JSON boundary handles optional values", () => expect(canonicalJson({ present: 1, omitted: undefined })).toBe('{"present":1}'));
  it("hashes exact bytes", () => expect(sha256Bytes(Buffer.from("FaultPact", "utf8"))).toBe("b883e57d8ef98ae0fc5483faf78af869bbc903eb104b27367251dfa18d16e819"));
});
