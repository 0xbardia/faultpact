import { describe, expect, it } from "vitest";
import { listIndexed, trackTransaction } from "./index.js";

describe("transaction tracking", () => {
  it("is idempotent by transaction hash", async () => {
    let calls = 0;
    const db = { transactionRecord: { upsert: async (input: { create: { status: string }; update: { status: string } }) => { calls += 1; return { id: input.update.status === "FINALIZED" ? 2 : 1 }; } } } as never;
    expect(await trackTransaction(db, { deploymentId: 1, txHash: "0xabc", method: "submit_evidence", status: "SUBMITTED" })).toEqual({ id: 1 });
    expect(await trackTransaction(db, { deploymentId: 1, txHash: "0xabc", method: "submit_evidence", status: "FINALIZED" })).toEqual({ id: 2 });
    expect(calls).toBe(2);
  });
});

it("CLAIMS_FILTER_BY_INCIDENT_ONCHAIN_ID", async () => {
  let captured: unknown;
  const db = { claim: {
    findMany: async (args: { where: unknown }) => { captured = args.where; return []; },
    count: async () => 0,
  } } as never;
  const result = await listIndexed(db, "claims", { deploymentId: 1, skip: 0, take: 25, incidentId: "42" });
  expect(result.total).toBe(0);
  expect((captured as { incident: { onchainId: { toString(): string } } }).incident.onchainId.toString()).toBe("42");
});
