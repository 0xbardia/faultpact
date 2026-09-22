import { describe, expect, it } from "vitest";
import { trackTransaction } from "./index.js";

describe("transaction tracking", () => {
  it("is idempotent by transaction hash", async () => {
    let calls = 0;
    const db = { transactionRecord: { upsert: async (input: { create: { status: string }; update: { status: string } }) => { calls += 1; return { id: input.update.status === "FINALIZED" ? 2 : 1 }; } } } as never;
    expect(await trackTransaction(db, { deploymentId: 1, txHash: "0xabc", method: "submit_evidence", status: "SUBMITTED" })).toEqual({ id: 1 });
    expect(await trackTransaction(db, { deploymentId: 1, txHash: "0xabc", method: "submit_evidence", status: "FINALIZED" })).toEqual({ id: 2 });
    expect(calls).toBe(2);
  });
});
