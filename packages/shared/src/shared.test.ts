import { describe, expect, it } from "vitest";
import { asBigInt, canonicalJson, isFrozenRpcUrl, loadEnv, sha256Bytes } from "./index.js";

const baseEnv = {
  DATABASE_URL: "postgresql://root@localhost:5432/faultpact",
  FAULTPACT_CONTRACT_ADDRESS: "0xeb858957e3C426597245f6b59E260f1cC556Bf13",
  FAULTPACT_SOURCE_SHA256: "4913a2af9cac39aac211f8f9fa66e1de8791986db495585c7a1ee9f757e7bb2e",
};

describe("configuration and precision", () => {
  it("CONFIG_WRONG_CHAIN_REJECTED", () => expect(() => loadEnv({ ...baseEnv, GENLAYER_CHAIN_ID: "61999" })).toThrow(/61997/));
  it("CONFIG_WRONG_CONTRACT_REJECTED", () => expect(() => loadEnv({ ...baseEnv, FAULTPACT_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001" })).toThrow());
  it("CONFIG_QUOTA_SAFE_DEFAULTS", () => expect(loadEnv(baseEnv)).toMatchObject({ INDEXER_POLL_INTERVAL_MS: 300000, INDEXER_RECONCILE_INTERVAL_MS: 1800000, INDEXER_RECONCILE_LIMIT: 10, GENLAYER_RPC_MIN_INTERVAL_MS: 3000, GENLAYER_RPC_DAILY_BUDGET: 1400, GENLAYER_RPC_PROBE_INTERVAL_MS: 1800000, PROBE_INTERVAL_MS: 30000 }));
  it("FROZEN_RPC_URL_CANONICALIZATION", () => {
    expect(isFrozenRpcUrl("https://studio-dev.genlayer.com/api")).toBe(true);
    expect(isFrozenRpcUrl("https://STUDIO-dev.genlayer.com:443/api/")).toBe(true);
    expect(isFrozenRpcUrl("https://studio-dev.genlayer.com/api?quota=bypass")).toBe(false);
    expect(isFrozenRpcUrl("http://studio-dev.genlayer.com/api")).toBe(false);
  });
  it("U256_PRECISION_PRESERVED", () => expect(asBigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935").toString()).toHaveLength(78));
  it("canonical JSON is key-order stable", () => expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}'));
  it("JSON boundary handles optional values", () => expect(canonicalJson({ present: 1, omitted: undefined })).toBe('{"present":1}'));
  it("hashes exact bytes", () => expect(sha256Bytes(Buffer.from("FaultPact", "utf8"))).toBe("b883e57d8ef98ae0fc5483faf78af869bbc903eb104b27367251dfa18d16e819"));
});
