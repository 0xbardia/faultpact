import { AUTHORITATIVE_EVIDENCE_TYPES, EVIDENCE_TYPES, normalizeAddress, normalizeHash256, sha256Bytes, type EvidenceType } from "@faultpact/shared";
import { evidenceUrl, type ProbeEvidenceV1 } from "./index.js";

/**
 * Signer-backed evidence submission: argument construction, public artifact
 * verification, contract read-back verification and retry-safe planning for the
 * frozen FaultPact contract.
 *
 * Contract signatures (frozen, verified against the deployed schema snapshot):
 *   attach_incident_report(incident_id, summary, evidence_uri, evidence_hash) -> int
 *   submit_evidence(incident_id, evidence_type, evidence_uri, content_hash, description) -> int
 *   get_incident_evidence_ids(incident_id) -> list[int]
 *   get_evidence(evidence_id) -> dict
 *   is_authorized_reporter(reporter) -> bool
 */

export const ATTACH_INCIDENT_REPORT = "attach_incident_report";
export const SUBMIT_EVIDENCE = "submit_evidence";
export const ATTACH_EVIDENCE_TYPE = "PROBE_REPORT";
export const OPEN_INCIDENT = "open_incident";

export { EVIDENCE_TYPES, AUTHORITATIVE_EVIDENCE_TYPES };
export type { EvidenceType };
export type Provenance = "AUTHORITATIVE" | "SUPPLEMENTAL";

export const MAX_URI_LENGTH = 512;
export const MAX_HASH_LENGTH = 64;
export const MAX_TEXT_LENGTH = 2048;
/** Frozen contract caps. Exceeding them would waste a signed transaction. */
export const MAX_AUTHORITATIVE_PER_REPORTER = 4;
export const MAX_SUPPLEMENTAL_PER_SUBMITTER = 4;

export class ReporterEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReporterEvidenceError";
  }
}

export type ContractMethodSchema = { params: Array<[string, string]>; readonly: boolean; ret: string };

/** Asserts the exact frozen parameter names/order before anything is signed. */
export function assertMethodSignature(schema: { methods: Record<string, ContractMethodSchema> }, method: string, expected: readonly string[]): void {
  const definition = schema.methods[method];
  if (!definition) throw new ReporterEvidenceError("UNKNOWN_CONTRACT_METHOD", `${method} is not part of the frozen FaultPact schema`);
  const actual = definition.params.map(([name]) => name);
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new ReporterEvidenceError("CONTRACT_SIGNATURE_MISMATCH", `${method} expects (${actual.join(", ")}), not (${expected.join(", ")})`);
  }
}

function assertUri(value: string): string {
  const uri = value.trim();
  if (uri.length === 0) throw new ReporterEvidenceError("EMPTY_ARTIFACT_URL", "evidence_uri must not be empty");
  if (uri.length > MAX_URI_LENGTH) throw new ReporterEvidenceError("ARTIFACT_URL_TOO_LONG", `evidence_uri must be at most ${MAX_URI_LENGTH} characters`);
  let parsed: URL;
  try { parsed = new URL(uri); }
  catch { throw new ReporterEvidenceError("INVALID_ARTIFACT_URL", "evidence_uri must be an absolute URL"); }
  if (parsed.protocol !== "https:") throw new ReporterEvidenceError("INVALID_ARTIFACT_URL", "evidence_uri must use HTTPS so the artifact is publicly verifiable");
  return uri;
}

function assertHash(value: string): string {
  let normalized: string;
  try { normalized = normalizeHash256(value); }
  catch { throw new ReporterEvidenceError("INVALID_ARTIFACT_HASH", "evidence hash must be 64 lowercase hexadecimal SHA-256 characters"); }
  if (normalized.length !== MAX_HASH_LENGTH) throw new ReporterEvidenceError("INVALID_ARTIFACT_HASH", "evidence hash must be 64 hexadecimal characters");
  return normalized;
}

function assertText(value: string, field: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ReporterEvidenceError("EMPTY_EVIDENCE_TEXT", `${field} must not be empty`);
  if (value.length > maxLength) throw new ReporterEvidenceError("EVIDENCE_TEXT_TOO_LONG", `${field} must be at most ${maxLength} characters`);
  return value;
}

function assertIncidentId(value: bigint | number | string): bigint {
  const id = typeof value === "bigint" ? value : BigInt(value);
  if (id < 0n) throw new ReporterEvidenceError("INVALID_INCIDENT_ID", "incident_id must be a non-negative integer");
  return id;
}

export type AttachIncidentReportArgs = [bigint, string, string, string];

export function buildAttachIncidentReportArgs(input: { incidentId: bigint | number | string; summary: string; artifactUrl: string; sha256: string }): AttachIncidentReportArgs {
  return [assertIncidentId(input.incidentId), assertText(input.summary, "summary"), assertUri(input.artifactUrl), assertHash(input.sha256)];
}

export type SubmitEvidenceArgs = [bigint, string, string, string, string];

export function buildSubmitEvidenceArgs(input: { incidentId: bigint | number | string; evidenceType: string; artifactUrl: string; sha256: string; description: string }): SubmitEvidenceArgs {
  const evidenceType = input.evidenceType.trim().toUpperCase();
  if (!(EVIDENCE_TYPES as readonly string[]).includes(evidenceType)) {
    throw new ReporterEvidenceError("INVALID_EVIDENCE_TYPE", `evidence_type must be one of ${EVIDENCE_TYPES.join(", ")}`);
  }
  return [assertIncidentId(input.incidentId), evidenceType, assertUri(input.artifactUrl), assertHash(input.sha256), assertText(input.description, "description")];
}

export type OpenIncidentArgs = [bigint, bigint, bigint, string, string, string];

/**
 * Builds `open_incident` arguments. The frozen contract only stores opener
 * evidence when `evidence_uri` is non-empty, so a fixture incident can be
 * opened without spending an evidence slot by passing an empty URI.
 */
export function buildOpenIncidentArgs(input: { serviceId: bigint | number | string; observedStart: bigint | number; observedEnd: bigint | number; summary: string; evidenceUrl?: string; sha256?: string }): OpenIncidentArgs {
  const start = BigInt(input.observedStart);
  const end = BigInt(input.observedEnd);
  if (end <= start) throw new ReporterEvidenceError("INVALID_INCIDENT_SPAN", "observed_end must be after observed_start");
  const evidenceUrl = (input.evidenceUrl ?? "").trim();
  const sha256 = evidenceUrl === "" ? "0".repeat(MAX_HASH_LENGTH) : assertHash(input.sha256 ?? "");
  return [BigInt(input.serviceId), start, end, assertText(input.summary, "summary"), evidenceUrl === "" ? "" : assertUri(evidenceUrl), sha256];
}

/** Evidence type the contract records for each reporter write method. */
export function storedEvidenceTypeFor(method: string, requestedType?: string): EvidenceType {
  if (method === ATTACH_INCIDENT_REPORT) return ATTACH_EVIDENCE_TYPE;
  const normalized = (requestedType ?? "").trim().toUpperCase();
  if (!(EVIDENCE_TYPES as readonly string[]).includes(normalized)) throw new ReporterEvidenceError("INVALID_EVIDENCE_TYPE", `evidence_type must be one of ${EVIDENCE_TYPES.join(", ")}`);
  return normalized as EvidenceType;
}

export function isAuthoritativeType(evidenceType: string): boolean {
  return (AUTHORITATIVE_EVIDENCE_TYPES as readonly string[]).includes(evidenceType.trim().toUpperCase());
}

// ---------------------------------------------------------------------------
// Public artifact verification (exact response bytes)
// ---------------------------------------------------------------------------

export type ArtifactFetchResult = { status: number; headers: Record<string, string>; body: Buffer };

export type ArtifactVerification = {
  url: string;
  status: number;
  contentType: string;
  sizeBytes: number;
  httpSha256: string;
  expectedSha256: string;
  matched: boolean;
};

export type ArtifactVerifierOptions = {
  url: string;
  expectedSha256: string;
  maxBytes: number;
  fetchBytes: (url: string) => Promise<ArtifactFetchResult>;
};

/**
 * Fetches the public artifact and hashes the exact response bytes. The body is
 * never parsed and re-serialized: JSON.parse/JSON.stringify is not evidence of
 * byte equality. Any mismatch fails closed before a transaction is signed.
 */
export async function verifyPublicArtifactBytes(options: ArtifactVerifierOptions): Promise<ArtifactVerification> {
  const url = assertUri(options.url);
  const expectedSha256 = assertHash(options.expectedSha256);
  if (!Number.isInteger(options.maxBytes) || options.maxBytes < 1) throw new ReporterEvidenceError("INVALID_ARTIFACT_SIZE_LIMIT", "artifact size limit must be a positive integer");
  let response: ArtifactFetchResult;
  try {
    response = await options.fetchBytes(url);
  } catch (error) {
    throw new ReporterEvidenceError("ARTIFACT_PUBLIC_URL_UNREACHABLE", `public artifact could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status !== 200) throw new ReporterEvidenceError("ARTIFACT_PUBLIC_URL_UNREACHABLE", `public artifact returned HTTP ${response.status}`);
  const contentType = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "application/json") throw new ReporterEvidenceError("ARTIFACT_CONTENT_TYPE_INVALID", `public artifact must be served as application/json, got ${contentType || "no content type"}`);
  const sizeBytes = response.body.byteLength;
  if (sizeBytes < 1) throw new ReporterEvidenceError("ARTIFACT_EMPTY", "public artifact returned no bytes");
  if (sizeBytes > options.maxBytes) throw new ReporterEvidenceError("ARTIFACT_TOO_LARGE", `public artifact is ${sizeBytes} bytes, above the ${options.maxBytes} byte limit`);
  const declaredLength = response.headers["content-length"];
  if (declaredLength !== undefined && /^\d+$/.test(declaredLength) && Number(declaredLength) !== sizeBytes) {
    throw new ReporterEvidenceError("ARTIFACT_LENGTH_MISMATCH", `public artifact declared ${declaredLength} bytes but returned ${sizeBytes}`);
  }
  const httpSha256 = sha256Bytes(response.body);
  if (httpSha256 !== expectedSha256) {
    throw new ReporterEvidenceError("ARTIFACT_HASH_MISMATCH", `public artifact SHA-256 ${httpSha256} does not match the stored artifact ${expectedSha256}`);
  }
  return { url, status: response.status, contentType, sizeBytes, httpSha256, expectedSha256, matched: true };
}

export function buildArtifactUrl(baseUrl: string, sha256: string): string {
  return evidenceUrl(baseUrl, assertHash(sha256));
}

// ---------------------------------------------------------------------------
// Contract read-back
// ---------------------------------------------------------------------------

export type EvidenceRecord = {
  id: string;
  incidentId: string;
  submitter: string;
  evidenceType: string;
  uri: string;
  contentHash: string;
  description: string;
  submittedAt: string;
  isChallenge: boolean;
  provenance: Provenance;
  reporterAuthorizedAtSubmission: boolean;
  hashAlgorithm: string;
};

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new ReporterEvidenceError("EVIDENCE_RECORD_INVALID", `contract evidence field ${field} is missing`);
}

function safeNormalizeHash(value: string): string | undefined {
  try { return normalizeHash256(value); }
  catch { return undefined; }
}

/** Normalizes a raw `get_evidence` record, preserving bigint precision. */
export function parseEvidenceRecord(raw: unknown): EvidenceRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ReporterEvidenceError("EVIDENCE_RECORD_INVALID", "contract evidence record must be an object");
  const record = raw as Record<string, unknown>;
  const provenance = requiredString(record.provenance, "provenance").toUpperCase();
  if (provenance !== "AUTHORITATIVE" && provenance !== "SUPPLEMENTAL") throw new ReporterEvidenceError("EVIDENCE_RECORD_INVALID", `unknown provenance ${provenance}`);
  return {
    id: requiredString(record.id, "id"),
    incidentId: requiredString(record.incident_id, "incident_id"),
    submitter: requiredString(record.submitter, "submitter"),
    evidenceType: requiredString(record.evidence_type, "evidence_type"),
    uri: requiredString(record.uri, "uri"),
    contentHash: requiredString(record.content_hash, "content_hash"),
    description: requiredString(record.description, "description"),
    submittedAt: requiredString(record.submitted_at, "submitted_at"),
    isChallenge: record.is_challenge === true,
    provenance,
    reporterAuthorizedAtSubmission: record.reporter_authorized_at_submission === true,
    hashAlgorithm: typeof record.hash_algorithm === "string" ? record.hash_algorithm : "SHA-256",
  };
}

export type ReadBackExpectation = {
  incidentId: bigint | number | string;
  artifactUrl: string;
  sha256: string;
  reporterAddress: string;
  evidenceType?: string;
  provenance?: Provenance;
  expectReporterAuthorized?: boolean;
};

export type ReadBackCheck = { name: string; expected: string; actual: string; passed: boolean };

export type ReadBackVerification = { passed: boolean; checks: ReadBackCheck[]; record: EvidenceRecord };

export function verifyEvidenceReadBack(record: EvidenceRecord, expectation: ReadBackExpectation): ReadBackVerification {
  const expectedIncidentId = expectation.incidentId.toString();
  const expectedHash = safeNormalizeHash(expectation.sha256) ?? expectation.sha256.trim().toLowerCase();
  const actualHash = safeNormalizeHash(record.contentHash) ?? record.contentHash.trim().toLowerCase();
  const expectedReporter = normalizeAddress(expectation.reporterAddress);
  const actualReporter = normalizeAddress(record.submitter);
  const expectedUri = expectation.artifactUrl.trim();
  const checks: ReadBackCheck[] = [
    { name: "incident_id", expected: expectedIncidentId, actual: record.incidentId, passed: record.incidentId === expectedIncidentId },
    { name: "uri", expected: expectedUri, actual: record.uri, passed: record.uri === expectedUri },
    { name: "content_hash", expected: expectedHash, actual: actualHash, passed: actualHash === expectedHash },
    { name: "submitter", expected: expectedReporter, actual: actualReporter, passed: actualReporter === expectedReporter },
    { name: "hash_algorithm", expected: "SHA-256", actual: record.hashAlgorithm.toUpperCase(), passed: record.hashAlgorithm.toUpperCase() === "SHA-256" },
    { name: "is_challenge", expected: "false", actual: String(record.isChallenge), passed: record.isChallenge === false },
  ];
  if (expectation.evidenceType !== undefined) {
    const expectedType = expectation.evidenceType.trim().toUpperCase();
    checks.push({ name: "evidence_type", expected: expectedType, actual: record.evidenceType.trim().toUpperCase(), passed: record.evidenceType.trim().toUpperCase() === expectedType });
  }
  if (expectation.provenance !== undefined) {
    checks.push({ name: "provenance", expected: expectation.provenance, actual: record.provenance, passed: record.provenance === expectation.provenance });
  }
  if (expectation.expectReporterAuthorized !== undefined) {
    checks.push({ name: "reporter_authorized_at_submission", expected: String(expectation.expectReporterAuthorized), actual: String(record.reporterAuthorizedAtSubmission), passed: record.reporterAuthorizedAtSubmission === expectation.expectReporterAuthorized });
  }
  const passed = checks.every((check) => check.passed);
  if (!passed) {
    const failed = checks.filter((check) => !check.passed).map((check) => `${check.name}: expected ${check.expected}, contract returned ${check.actual}`).join("; ");
    throw new ReporterEvidenceError("EVIDENCE_READ_BACK_MISMATCH", failed);
  }
  return { passed, checks, record };
}

// ---------------------------------------------------------------------------
// Retry-safe planning
// ---------------------------------------------------------------------------

export type PriorAttempt = {
  method: string;
  status: string;
  txHash?: string | null;
  evidenceId?: string | null;
  artifactUrl?: string | null;
  sha256?: string | null;
  reporter?: string | null;
  failureCategory?: string | null;
  finalizedAt?: Date | string | null;
};

export type SubmissionStep = {
  method: string;
  evidenceType: EvidenceType;
  /** Already present in contract state with identical uri/hash/submitter: never resubmitted. */
  alreadyOnchain?: { evidenceId: string; record: EvidenceRecord };
  /** A previous attempt is unresolved; its transaction must be reconciled before any new write. */
  reconcileTxHash?: string;
};

export type SubmissionPlan = { steps: SubmissionStep[]; alreadyOnchain: number; reconcile: number; submit: number };

function matches(record: EvidenceRecord, input: { artifactUrl: string; sha256: string; reporterAddress: string; evidenceType: EvidenceType }): boolean {
  const expectedHash = safeNormalizeHash(input.sha256) ?? "";
  const actualHash = safeNormalizeHash(record.contentHash) ?? "";
  return record.uri.trim() === input.artifactUrl.trim()
    && actualHash === expectedHash
    && record.evidenceType.trim().toUpperCase() === input.evidenceType
    && normalizeAddress(record.submitter) === normalizeAddress(input.reporterAddress)
    && record.isChallenge === false;
}

export async function planEvidenceSubmissions(input: {
  incidentId: bigint;
  artifactUrl: string;
  sha256: string;
  reporterAddress: string;
  attachEvidenceType: EvidenceType;
  submitEvidenceType: EvidenceType;
  existingEvidenceIds: readonly bigint[];
  readEvidence: (evidenceId: bigint) => Promise<EvidenceRecord>;
  priorAttempts: readonly PriorAttempt[];
}): Promise<SubmissionPlan> {
  const records: EvidenceRecord[] = [];
  for (const id of input.existingEvidenceIds) records.push(await input.readEvidence(id));
  const steps: SubmissionStep[] = [];
  let alreadyOnchain = 0;
  let reconcile = 0;
  let submit = 0;
  for (const [method, evidenceType] of [["attach_incident_report", input.attachEvidenceType], ["submit_evidence", input.submitEvidenceType]] as Array<[string, EvidenceType]>) {
    const existing = records.find((record) => matches(record, { artifactUrl: input.artifactUrl, sha256: input.sha256, reporterAddress: input.reporterAddress, evidenceType }));
    if (existing) {
      alreadyOnchain += 1;
      steps.push({ method, evidenceType, alreadyOnchain: { evidenceId: existing.id, record: existing } });
      continue;
    }
    const unresolved = input.priorAttempts
      .filter((attempt) => attempt.method === method && attempt.status !== "FINALIZED" && attempt.status !== "FAILED" && attempt.txHash)
      .sort((left, right) => Number(new Date(right.finalizedAt ?? 0).toString() || 0) - Number(new Date(left.finalizedAt ?? 0).toString() || 0))[0];
    if (unresolved?.txHash) {
      reconcile += 1;
      steps.push({ method, evidenceType, reconcileTxHash: unresolved.txHash });
      continue;
    }
    submit += 1;
    steps.push({ method, evidenceType });
  }
  return { steps, alreadyOnchain, reconcile, submit };
}

export type ReporterCapacityIssue = { code: "MAX_AUTHORITATIVE_PER_REPORTER" | "MAX_SUPPLEMENTAL_PER_SUBMITTER"; limit: number; existing: number };

/** Fails fast when the frozen per-submitter evidence caps leave no room for a new record. */
export function checkReporterEvidenceCapacity(input: { records: readonly EvidenceRecord[]; reporterAddress: string; evidenceType: EvidenceType; pending: number }): ReporterCapacityIssue | undefined {
  const authoritative = isAuthoritativeType(input.evidenceType);
  const limit = authoritative ? MAX_AUTHORITATIVE_PER_REPORTER : MAX_SUPPLEMENTAL_PER_SUBMITTER;
  let existing = 0;
  for (const record of input.records) {
    if (record.isChallenge) continue;
    if (normalizeAddress(record.submitter) !== normalizeAddress(input.reporterAddress)) continue;
    if ((record.provenance === "AUTHORITATIVE") !== authoritative) continue;
    existing += 1;
  }
  if (existing + input.pending >= limit) return { code: authoritative ? "MAX_AUTHORITATIVE_PER_REPORTER" : "MAX_SUPPLEMENTAL_PER_SUBMITTER", limit, existing };
  return undefined;
}

export function buildProbeEvidenceForIncident(input: { serviceId: number; region: string; observedStart: number; observedEnd: number; probeId: string; availabilityPpm: number; errorRatePpm: number; incidentConfirmed?: boolean; faultDomain?: ProbeEvidenceV1["fault_domain"]; sequence?: number }): ProbeEvidenceV1 {
  return {
    schema: "faultpact-probe-v1",
    service_id: input.serviceId,
    region: input.region.trim().toLowerCase(),
    observed_start: input.observedStart,
    observed_end: input.observedEnd,
    availability_ppm: input.availabilityPpm,
    p95_latency_ms: null,
    error_rate_ppm: input.errorRatePpm,
    block_lag: null,
    chain_level_failure: false,
    fault_domain: input.faultDomain ?? (input.incidentConfirmed ? "PROVIDER" : "UNKNOWN"),
    incident_confirmed: input.incidentConfirmed === true,
    probe_id: input.probeId,
    sequence: input.sequence ?? input.observedEnd,
  };
}
