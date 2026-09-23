import { describe, expect, it } from "vitest";
import { formatBpsAsPercentage, formatDurationSeconds, formatGen, formatPpmAsPercentage, formatAddress, formatUnixSeconds, genDecimal, parseGen, statusTone } from "./format";

describe("frontend protocol formatting", () => {
  it("preserves all wei when displaying GEN", () => {
    expect(formatGen("1000000000000000001")).toBe("1.000000000000000001 GEN");
    expect(formatGen("500")).toBe("0.0000000000000005 GEN");
  });
  it("converts ppm without floating point", () => expect(formatPpmAsPercentage("999500")).toBe("99.95%"));
  it("converts basis points to a percentage", () => expect(formatBpsAsPercentage("1000")).toBe("10%"));
  it("round trips exact human GEN amounts without Number conversion", () => {
    expect(genDecimal("1")).toBe("0.000000000000000001");
    expect(parseGen("0.000000000000000001")).toBe(1n);
    expect(parseGen("1.25")).toBe(1_250_000_000_000_000_000n);
    expect(parseGen("1.0000000000000000001")).toBeNull();
  });
  it("uses readable durations", () => expect(formatDurationSeconds("600")).toBe("10 min"));
  it("formats Unix seconds as a date", () => expect(formatUnixSeconds("1790000000")).toContain("2026"));
  it("shortens only real addresses", () => expect(formatAddress("0x1234567890123456789012345678901234567890")).toBe("0x1234…7890"));
  it("does not turn unknown into healthy", () => expect(statusTone("UNKNOWN")).toBe("neutral"));
});
