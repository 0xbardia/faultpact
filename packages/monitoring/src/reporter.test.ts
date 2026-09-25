import { describe, expect, it } from "vitest";
import {
  assertMethodSignature,
  buildArtifactUrl,
  buildAttachIncidentReportArgs,
  buildProbeEvidenceForIncident,
  buildSubmitEvidenceArgs,
  checkReporterEvidenceCapacity,
  parseEvidenceRecord,
  planEvidenceSubmissions,
  ReporterEvidenceError,
  storedEvidenceTypeFor,
  verifyEvidenceReadBack,
  verifyPublicArtifactBytes,
  type EvidenceRecord,
} from "./reporter.js";
import { canonicalJson, sha256Bytes } from "@faultpact/shared";

const SHA = "a".repeat(64);
const REPORTER = "0x99FF79513004dB21546a0c1b419f48ae30760580";
const URL_ = `https://faultpact.bydx.fun/evidence/${SHA}.json`;

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "1",
    incidentId: "12",
    submitter: REPORTER,
    evidenceType: "PROBE_REPORT",
    uri: URL_,
    contentHash: SHA,
    description: "d",
    submittedAt: "1790000000",
    isChallenge: false,
    provenance: "AUTHORITATIVE",
    reporterAuthorizedAtSubmission: true,
    hashAlgorithm: "SHA-256",
    ...overrides,
  };
}

const json = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) => ({ status: 200, headers, body: Buffer.from(body, "utf8") });

async function expectCode(code: string, operation: () => Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try { await operation(); }
  catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(ReporterEvidenceError);
  expect((thrown as ReporterEvidenceError).code).toBe(code);
}

describe("reporter argument construction", () => {
  it("BUILDS_EXACT_CONTRACT_ARGUMENTS", () => {
    expect(buildAttachIncidentReportArgs({ incidentId: 12, summary: "s", artifactUrl: URL_, sha256: SHA })).toEqual([12n, "s", URL_, SHA]);
    expect(buildSubmitEvidenceArgs({ incidentId: "12", evidenceType: "third_party_monitor", artifactUrl: URL_, sha256: `0x${SHA.toUpperCase()}`, description: "d" })).toEqual([12n, "THIRD_PARTY_MONITOR", URL_, SHA, "d"]);
    expect(storedEvidenceTypeFor("attach_incident_report")).toBe("PROBE_REPORT");
    expect(storedEvidenceTypeFor("submit_evidence", "third_party_monitor")).toBe("THIRD_PARTY_MONITOR");
  });

  it("REJECTS_UNSAFE_ARGUMENTS_BEFORE_SIGNING", () => {
    expect(() => buildAttachIncidentReportArgs({ incidentId: 12, summary: " ", artifactUrl: URL_, sha256: SHA })).toThrow(ReporterEvidenceError);
    expect(() => buildAttachIncidentReportArgs({ incidentId: 12, summary: "s", artifactUrl: "ftp://x/y.json", sha256: SHA })).toThrow(/HTTPS/);
    expect(() => buildAttachIncidentReportArgs({ incidentId: 12, summary: "s", artifactUrl: "https://x/y.json", sha256: "abc" })).toThrow(/64 lowercase/);
    expect(() => buildAttachIncidentReportArgs({ incidentId: 12, summary: "x".repeat(2049), artifactUrl: URL_, sha256: SHA })).toThrow(/2048/);
    expect(() => buildAttachIncidentReportArgs({ incidentId: 12, summary: "s", artifactUrl: `https://x/${"y".repeat(600)}.json`, sha256: SHA })).toThrow(/512/);
    expect(() => buildSubmitEvidenceArgs({ incidentId: 12, evidenceType: "UNKNOWN_TYPE", artifactUrl: URL_, sha256: SHA, description: "d" })).toThrow(/evidence_type/);
  });

  it("CONSTRUCTS_THE_PUBLIC_ARTIFACT_URL_FROM_THE_HASH", () => {
    expect(buildArtifactUrl("https://faultpact.bydx.fun/evidence/", SHA)).toBe(URL_);
    expect(buildArtifactUrl("https://faultpact.bydx.fun/evidence", `0x${SHA.toUpperCase()}`)).toBe(URL_);
    expect(() => buildArtifactUrl("https://faultpact.bydx.fun/evidence", "nope")).toThrow(ReporterEvidenceError);
  });

  it("BUILDS_A_CANONICAL_PROBE_ARTIFACT", () => {
    const value = buildProbeEvidenceForIncident({ serviceId: 3, region: "Frankfurt", observedStart: 100, observedEnd: 400, probeId: "p-1", availabilityPpm: 900_000, errorRatePpm: 100_000 });
    const bytes = Buffer.from(canonicalJson(value), "utf8");
    expect(value.region).toBe("frankfurt");
    expect(sha256Bytes(bytes)).toMatch(/^[a-f0-9]{64}$/);
    expect(bytes.toString("utf8")).toBe(canonicalJson(JSON.parse(bytes.toString("utf8"))));
    expect(() => buildProbeEvidenceForIncident({ serviceId: 3, region: "frankfurt", observedStart: 400, observedEnd: 400, probeId: "p", availabilityPpm: 0, errorRatePpm: 0 })).not.toThrow();
  });
});

describe("public artifact verification", () => {
  it("VERIFIES_THE_EXACT_HTTP_BYTES", async () => {
    const bytes = Buffer.from('{"schema":"faultpact-probe-v1"}', "utf8");
    const result = await verifyPublicArtifactBytes({ url: URL_, expectedSha256: sha256Bytes(bytes), maxBytes: 1024, fetchBytes: async () => json(bytes.toString("utf8")) });
    expect(result.matched).toBe(true);
    expect(result.httpSha256).toBe(sha256Bytes(bytes));
    expect(result.sizeBytes).toBe(bytes.byteLength);
  });

  it("FAILS_CLOSED_ON_EVERY_MISMATCH", async () => {
    const bytes = Buffer.from('{"a":1}', "utf8");
    const hash = sha256Bytes(bytes);
    await expectCode("ARTIFACT_HASH_MISMATCH", () => verifyPublicArtifactBytes({ url: URL_, expectedSha256: hash, maxBytes: 1024, fetchBytes: async () => json('{"a": 1}', { "content-type": "application/json" }) }));
    await expectCode("ARTIFACT_PUBLIC_URL_UNREACHABLE", () => verifyPublicArtifactBytes({ url: URL_, expectedSha256: hash, maxBytes: 1024, fetchBytes: async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }) }));
    await expectCode("ARTIFACT_CONTENT_TYPE_INVALID", () => verifyPublicArtifactBytes({ url: URL_, expectedSha256: hash, maxBytes: 1024, fetchBytes: async () => json(bytes.toString("utf8"), { "content-type": "text/html" }) }));
    await expectCode("ARTIFACT_TOO_LARGE", () => verifyPublicArtifactBytes({ url: URL_, expectedSha256: hash, maxBytes: 1, fetchBytes: async () => json(bytes.toString("utf8")) }));
    await expectCode("ARTIFACT_LENGTH_MISMATCH", () => verifyPublicArtifactBytes({ url: URL_, expectedSha256: hash, maxBytes: 1024, fetchBytes: async () => json(bytes.toString("utf8"), { "content-type": "application/json", "content-length": "99" }) }));
    await expectCode("ARTIFACT_PUBLIC_URL_UNREACHABLE", () => verifyPublicArtifactBytes({ url: URL_, expectedSha256: hash, maxBytes: 1024, fetchBytes: async () => { throw new Error("ECONNREFUSED"); } }));
    await expectCode("INVALID_ARTIFACT_SIZE_LIMIT", () => verifyPublicArtifactBytes({ url: URL_, expectedSha256: hash, maxBytes: 0, fetchBytes: async () => json(bytes.toString("utf8")) }));
  });

  it("FAILS_CLOSED_ON_AN_EMPTY_BODY", async () => {
    await expectCode("ARTIFACT_EMPTY", () => verifyPublicArtifactBytes({ url: URL_, expectedSha256: sha256Bytes(Buffer.alloc(0)), maxBytes: 1024, fetchBytes: async () => json("") }));
  });
});

describe("contract read-back", () => {
  it("PARSES_A_CONTRACT_EVIDENCE_RECORD_WITHOUT_NUMBER_LOSS", () => {
    const parsed = parseEvidenceRecord({ id: 2n ** 70n, incident_id: 12n, submitter: REPORTER, evidence_type: "THIRD_PARTY_MONITOR", uri: URL_, content_hash: SHA, description: "d", submitted_at: 1790000000n, is_challenge: false, provenance: "AUTHORITATIVE", reporter_authorized_at_submission: true, hash_algorithm: "SHA-256" });
    expect(parsed.id).toBe((2n ** 70n).toString());
    expect(parsed.incidentId).toBe("12");
    expect(parsed.submittedAt).toBe("1790000000");
    expect(parsed.provenance).toBe("AUTHORITATIVE");
    expect(() => parseEvidenceRecord({ id: 1n, incident_id: 1n, submitter: REPORTER, evidence_type: "PROBE_REPORT", uri: URL_, content_hash: SHA, description: "d", submitted_at: 1n, is_challenge: false, provenance: "WEIRD" })).toThrow(/unknown provenance/);
    expect(() => parseEvidenceRecord(null)).toThrow(ReporterEvidenceError);
  });

  it("ASSERTS_URI_HASH_INCIDENT_AND_SENDER", () => {
    const expectation = { incidentId: 12, artifactUrl: URL_, sha256: SHA, reporterAddress: REPORTER, evidenceType: "PROBE_REPORT", provenance: "AUTHORITATIVE" as const, expectReporterAuthorized: true };
    expect(verifyEvidenceReadBack(record(), expectation).passed).toBe(true);
    expect(verifyEvidenceReadBack(record({ contentHash: `0x${SHA.toUpperCase()}` }), expectation).passed).toBe(true);
    expect(verifyEvidenceReadBack(record({ submitter: REPORTER.toLowerCase() }), expectation).passed).toBe(true);
    expect(() => verifyEvidenceReadBack(record({ uri: "https://faultpact.bydx.fun/evidence/other.json" }), expectation)).toThrow(/uri/);
    expect(() => verifyEvidenceReadBack(record({ contentHash: "b".repeat(64) }), expectation)).toThrow(/content_hash/);
    expect(() => verifyEvidenceReadBack(record({ incidentId: "13" }), expectation)).toThrow(/incident_id/);
    expect(() => verifyEvidenceReadBack(record({ submitter: "0x870C3e1f3059ce369dA57B12431212aD6Cf84073" }), expectation)).toThrow(/submitter/);
    expect(() => verifyEvidenceReadBack(record({ provenance: "SUPPLEMENTAL" }), expectation)).toThrow(/provenance/);
    expect(() => verifyEvidenceReadBack(record({ reporterAuthorizedAtSubmission: false }), expectation)).toThrow(/reporter_authorized_at_submission/);
    expect(() => verifyEvidenceReadBack(record({ evidenceType: "CUSTOMER_LOG" }), expectation)).toThrow(/evidence_type/);
  });
});

describe("retry-safe planning", () => {
  const base = {
    incidentId: 12n,
    artifactUrl: URL_,
    sha256: SHA,
    reporterAddress: REPORTER,
    attachEvidenceType: "PROBE_REPORT" as const,
    submitEvidenceType: "THIRD_PARTY_MONITOR" as const,
  };

  it("SKIPS_WRITES_WHOSE_EVIDENCE_ALREADY_EXISTS_ONCHAIN", async () => {
    const plan = await planEvidenceSubmissions({ ...base, existingEvidenceIds: [1n, 2n], readEvidence: async (id) => record({ id: String(id), evidenceType: id === 1n ? "PROBE_REPORT" : "THIRD_PARTY_MONITOR" }), priorAttempts: [] });
    expect(plan.submit).toBe(0);
    expect(plan.alreadyOnchain).toBe(2);
    expect(plan.steps.map((step) => step.alreadyOnchain?.evidenceId)).toEqual(["1", "2"]);
  });

  it("RECONCILES_AN_UNRESOLVED_TRANSACTION_INSTEAD_OF_RESUBMITTING", async () => {
    const plan = await planEvidenceSubmissions({ ...base, existingEvidenceIds: [], readEvidence: async () => record(), priorAttempts: [{ method: "attach_incident_report", status: "SUBMITTED", txHash: "0xabc" }] });
    expect(plan.reconcile).toBe(1);
    expect(plan.steps[0]?.reconcileTxHash).toBe("0xabc");
    expect(plan.steps[1]?.method).toBe("submit_evidence");
  });

  it("IGNORES_DECIDED_ATTEMPTS_WHEN_PLANNING", async () => {
    const plan = await planEvidenceSubmissions({ ...base, existingEvidenceIds: [], readEvidence: async () => record(), priorAttempts: [{ method: "attach_incident_report", status: "FAILED", txHash: "0xabc" }] });
    expect(plan.submit).toBe(2);
  });

  it("DOES_NOT_MATCH_EVIDENCE_FROM_ANOTHER_REPORTER_OR_ARTIFACT", async () => {
    const other = await planEvidenceSubmissions({ ...base, existingEvidenceIds: [1n], readEvidence: async () => record({ submitter: "0x870C3e1f3059ce369dA57B12431212aD6Cf84073" }), priorAttempts: [] });
    expect(other.alreadyOnchain).toBe(0);
    const otherHash = await planEvidenceSubmissions({ ...base, existingEvidenceIds: [1n], readEvidence: async () => record({ contentHash: "c".repeat(64) }), priorAttempts: [] });
    expect(otherHash.alreadyOnchain).toBe(0);
  });
});

describe("frozen evidence caps", () => {
  it("STOPS_BEFORE_THE_PER_REPORTER_LIMIT", () => {
    const records = [record({ id: "1" }), record({ id: "2" }), record({ id: "3", evidenceType: "THIRD_PARTY_MONITOR" })];
    expect(checkReporterEvidenceCapacity({ records, reporterAddress: REPORTER, evidenceType: "PROBE_REPORT", pending: 0 })).toBeUndefined();
    expect(checkReporterEvidenceCapacity({ records, reporterAddress: REPORTER, evidenceType: "PROBE_REPORT", pending: 1 })?.code).toBe("MAX_AUTHORITATIVE_PER_REPORTER");
    const supplemental = [record({ id: "1", provenance: "SUPPLEMENTAL", evidenceType: "CUSTOMER_LOG" })];
    expect(checkReporterEvidenceCapacity({ records: supplemental, reporterAddress: REPORTER, evidenceType: "CUSTOMER_LOG", pending: 0 })).toBeUndefined();
    expect(checkReporterEvidenceCapacity({ records: supplemental, reporterAddress: REPORTER, evidenceType: "CUSTOMER_LOG", pending: 4 })?.code).toBe("MAX_SUPPLEMENTAL_PER_SUBMITTER");
    expect(checkReporterEvidenceCapacity({ records: [record({ id: "1", submitter: "0x870C3e1f3059ce369dA57B12431212aD6Cf84073" })], reporterAddress: REPORTER, evidenceType: "PROBE_REPORT", pending: 3 })).toBeUndefined();
  });
});
