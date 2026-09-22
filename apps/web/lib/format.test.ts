import { describe, expect, it } from "vitest";
import { formatGen, formatPpmAsPercentage, formatAddress, statusTone } from "./format";

describe("frontend protocol formatting", () => {
  it("preserves integer precision for GEN", () => expect(formatGen("1000000000000000001")).toBe("1.000000 GEN"));
  it("converts ppm without floating point", () => expect(formatPpmAsPercentage("999500")).toBe("99.95%"));
  it("shortens only real addresses", () => expect(formatAddress("0x1234567890123456789012345678901234567890")).toBe("0x1234…7890"));
  it("does not turn unknown into healthy", () => expect(statusTone("UNKNOWN")).toBe("neutral"));
});
