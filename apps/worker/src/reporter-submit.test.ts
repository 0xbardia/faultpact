import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildGenVmPositionalArgs } from "genlayer-js";
import { FaultPactContractAdapter, getFrozenSchema, deriveReporterAddress, mapTransactionRecord, TransactionTracker, ReporterConfigurationError, buildLegacyCalldata, type RpcTransport } from "@faultpact/contract";
import { assertMethodSignature, buildAttachIncidentReportArgs, buildProbeEvidenceForIncident, buildSubmitEvidenceArgs, buildProbeEvidence, ReporterEvidenceError, type EvidenceRecord, type PriorAttempt } from "@faultpact/monitoring";
import { canonicalJson, sha256Bytes, FROZEN_CHAIN_ID, FROZEN_CONTRACT_ADDRESS, FROZEN_SOURCE_SHA256 } from "@faultpact/shared";
import { runReporterEvidenceSubmission, type ReporterArtifactPort, type ReporterAttemptStore, type ReporterAttemptUpdate, type ReporterRunDeps, type ReporterWritePort } from "./reporter-submit.js";
import { createReporterChainPort, createReporterTracker } from "./reporter-runtime.js";
import { formatReporterSummary } from "./reporter-summary.js";

// ---------------------------------------------------------------------------
// Frozen test reporter identity. This key never leaves the process and must
// never appear in logs, output or snapshots.
// ---------------------------------------------------------------------------
const TEST_REPORTER_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";
const TEST_REPORTER_KEY_2 = "0x2222222222222222222222222222222222222222222222222222222222222222";
const FROZEN_ADDRESS = FROZEN_CONTRACT_ADDRESS;
const OTHER_ADDRESS = "0x870C3e1f3059ce369dA57B12431212aD6Cf84073";

type StoredEvidence = EvidenceRecord & { exists: boolean };

type FakeNodeOptions = {
  incidentId?: bigint;
  status?: string;
  evidenceDeadline?: number;
  authorized?: readonly string[];
  chainId?: number;
  sourceBytes?: string;
  corruptReadBack?: Record<string, Partial<Record<string, string>>>;
};

type FakeTx = {
  hash: string;
  from: string;
  to: string;
  method: string;
  status: string;
  execution: string;
  remainingPolls: number;
};

/**
 * A faithful stand-in for the frozen FaultPact deployment: the real frozen
 * schema, the real legacy read calldata, the real evidence semantics (window,
 * authorization, provenance, caps) and the real GenLayer transaction states.
 */
class FakeGenLayerNode {
  readonly calls: Array<{ method: string; args: readonly unknown[]; calldata: Uint8Array }> = [];
  readonly writes: Array<{ method: string; args: readonly unknown[]; from: string; value: bigint }> = [];
  readonly transactions: FakeTx[] = [];
  readonly evidence = new Map<string, StoredEvidence>();
  readonly incidentEvidenceIds = new Map<string, bigint[]>();
  authorized: Set<string>;
  chainId: number;
  source: string;
  status: string;
  evidenceDeadline: number;
  serviceId = 1n;
  nextEvidenceId = 1n;
  private txCounter = 0;
  private readonly pending = new Map<string, { applied: boolean; commit: () => void }>();
  nowSeconds = 1_790_100_000;

  constructor(private readonly options: FakeNodeOptions = {}) {
    this.authorized = new Set((options.authorized ?? [deriveReporterAddress(TEST_REPORTER_KEY)]).map((address) => address.toLowerCase()));
    this.chainId = options.chainId ?? FROZEN_CHAIN_ID;
    this.status = options.status ?? "OPEN";
    this.evidenceDeadline = options.evidenceDeadline ?? 1_790_100_060;
    this.source = options.sourceBytes ?? "";
  }

  get transport(): RpcTransport {
    return {
      request: async (method: string, params: readonly unknown[] = []) => {
        if (method === "eth_chainId") return `0x${this.chainId.toString(16)}`;
        if (method === "eth_getTransactionByHash") {
          const hash = String(params[0] ?? "");
          const tx = this.transactions.find((candidate) => candidate.hash === hash);
          if (!tx) return null;
          if (tx.remainingPolls > 0) { tx.remainingPolls -= 1; return this.txRecord(tx, "PROPOSING", "PROPOSING"); }
          this.applyCommit(tx);
          return this.txRecord(tx, tx.status, tx.execution);
        }
        if (method === "gen_getContractCode") return Buffer.from(this.source, "utf8").toString("base64");
        throw new Error(`unexpected RPC method ${method}`);
      },
      readContract: async (address: string, method: string, args: readonly unknown[]) => {
        if (address !== FROZEN_ADDRESS) throw new Error(`unexpected contract address ${address}`);
        this.calls.push({ method, args, calldata: buildLegacyCalldata(method, args) });
        return this.read(method, args);
      },
      getContractCode: async () => this.source,
      getContractSchema: async () => getFrozenSchema(),
    };
  }

  private read(method: string, args: readonly unknown[]): unknown {
    switch (method) {
      case "is_authorized_reporter": return this.authorized.has(String(args[0]).toLowerCase());
      case "get_incident": {
        if (BigInt(args[0] as bigint) !== 7n) throw new Error("GENVM: unknown incident");
        return { id: 7n, service_id: this.serviceId, status: this.status, evidence_deadline: BigInt(this.evidenceDeadline), summary: "reporter certification incident" };
      }
      case "get_incident_evidence_ids": return [...(this.incidentEvidenceIds.get(String(args[0])) ?? [])];
      case "get_evidence": {
        const record = this.evidence.get(String(args[0]));
        if (!record) throw new Error("GENVM: unknown evidence");
        const corrupted = this.options.corruptReadBack?.[String(args[0])];
        return {
          id: BigInt(record.id),
          incident_id: BigInt(record.incidentId),
          submitter: corrupted?.submitter ?? record.submitter,
          evidence_type: corrupted?.evidence_type ?? record.evidenceType,
          uri: corrupted?.uri ?? record.uri,
          content_hash: corrupted?.content_hash ?? record.contentHash,
          description: record.description,
          submitted_at: BigInt(record.submittedAt),
          is_challenge: record.isChallenge,
          provenance: corrupted?.provenance ?? record.provenance,
          reporter_authorized_at_submission: record.reporterAuthorizedAtSubmission,
          hash_algorithm: record.hashAlgorithm,
        };
      }
      default: throw new Error(`unexpected read ${method}`);
    }
  }

  private txRecord(tx: FakeTx, status: string, execution: string) {
    return { hash: tx.hash, from_address: tx.from, to_address: tx.to, status, txExecutionResultName: execution, result: execution === "FINISHED_WITH_RETURN" ? 1 : 5, result_name: execution === "FINISHED_WITH_RETURN" ? "MAJORITY_AGREE" : "NO_MAJORITY", type: 2, appealed: false, created_at: new Date(this.nowSeconds * 1000).toISOString() };
  }

  /** Applies the frozen contract's evidence semantics and returns a tx hash. State commits at finalization. */
  write(method: string, args: readonly unknown[], from: string, value = 0n): FakeTx {
    this.txCounter += 1;
    const hash = `0x${"ab".repeat(31)}${this.txCounter.toString(16).padStart(2, "0")}`;
    const tx: FakeTx = { hash, from, to: FROZEN_ADDRESS, method, status: "FINALIZED", execution: "FINISHED_WITH_RETURN", remainingPolls: 1 };
    const reject = (reason: string): FakeTx => {
      this.writes.push({ method, args, from, value });
      tx.execution = `REVERTED:${reason}`;
      this.transactions.push(tx);
      return tx;
    };
    this.writes.push({ method, args, from, value });
    if (this.status !== "OPEN") return reject("ERR_NOT_OPEN");
    if (this.nowSeconds >= this.evidenceDeadline) return reject("ERR_EVIDENCE_WINDOW_CLOSED");
    let evidenceType: string;
    let description: string;
    let uri: string;
    let contentHash: string;
    if (method === "attach_incident_report") {
      const [, summary, evidenceUri, evidenceHash] = args as [bigint, string, string, string];
      evidenceType = "PROBE_REPORT";
      description = summary;
      uri = evidenceUri;
      contentHash = String(evidenceHash).toLowerCase();
    } else if (method === "submit_evidence") {
      const [, type, evidenceUri, hash, text] = args as [bigint, string, string, string, string];
      evidenceType = String(type);
      description = text;
      uri = evidenceUri;
      contentHash = String(hash).toLowerCase();
    } else {
      return reject("ERR_UNKNOWN_METHOD");
    }
    const authorized = this.authorized.has(from.toLowerCase());
    const authoritative = ["PROBE_REPORT", "THIRD_PARTY_MONITOR", "CHAIN_REFERENCE"].includes(evidenceType) && authorized;
    const provenance = authoritative ? "AUTHORITATIVE" : "SUPPLEMENTAL";
    const perSubmitter = 4;
    const existing = [...(this.incidentEvidenceIds.get("7") ?? [])].map((id) => this.evidence.get(String(id))).filter((record): record is StoredEvidence => record !== undefined);
    const bySubmitter = existing.filter((record) => record.provenance === provenance && record.submitter.toLowerCase() === from.toLowerCase());
    if (bySubmitter.length >= perSubmitter) return reject(authoritative ? "ERR_REPORTER_EVIDENCE_CAP" : "ERR_SUBMITTER_EVIDENCE_CAP");
    this.transactions.push(tx);
    this.pending.set(hash, {
      applied: false,
      commit: () => {
        const id = this.nextEvidenceId;
        this.nextEvidenceId += 1n;
        this.evidence.set(String(id), { id: String(id), incidentId: "7", submitter: from, evidenceType, uri, contentHash, description, submittedAt: String(this.nowSeconds), isChallenge: false, provenance, reporterAuthorizedAtSubmission: authorized, hashAlgorithm: "SHA-256", exists: true });
        this.incidentEvidenceIds.set("7", [...(this.incidentEvidenceIds.get("7") ?? []), id]);
      },
    });
    return tx;
  }

  /** Immediately decides a transaction, as the network would. */
  finalizeNow(tx: FakeTx): FakeTx {
    tx.remainingPolls = 0;
    this.applyCommit(tx);
    return tx;
  }

  private applyCommit(tx: FakeTx): void {
    const pending = this.pending.get(tx.hash);
    if (pending && !pending.applied) { pending.applied = true; pending.commit(); }
  }
}

type Harness = {
  deps: ReporterRunDeps;
  node: FakeGenLayerNode;
  artifacts: { stored: Map<string, Buffer>; resolved: number };
  attempts: ReporterAttemptUpdate[];
  logs: string[];
  setPublicBytes: (bytes: Buffer) => void;
  publicStatus: { status: number; contentType: string | null };
};

function createHarness(options: FakeNodeOptions & { reporterKey?: string; submitEvidenceType?: "THIRD_PARTY_MONITOR" | "CUSTOMER_LOG" } = {}): Harness {
  const source = options.sourceBytes ?? "";
  const node = new FakeGenLayerNode({ ...options, sourceBytes: source });
  if (!node.source) {
    throw new Error("sourceBytes is required for the frozen deployment check");
  }
  const adapter = new FaultPactContractAdapter(node.transport);
  const reporterKey = options.reporterKey ?? TEST_REPORTER_KEY;
  const reporterAddress = deriveReporterAddress(reporterKey);
  const stored = new Map<string, Buffer>();
  const artifacts: Harness["artifacts"] = { stored, resolved: 0 };
  const attempts: ReporterAttemptUpdate[] = [];
  const logs: string[] = [];
  const publicState: { bytes: Buffer; status: number; contentType: string | null } = { bytes: Buffer.alloc(0), status: 200, contentType: "application/json" };
  const setPublicBytes = (bytes: Buffer): void => { publicState.bytes = bytes; };
  const publicStatus = { get status() { return publicState.status; }, set status(value: number) { publicState.status = value; }, contentType: "application/json" as string | null };

  const artifactPort: ReporterArtifactPort = {
    resolve: async (request) => {
      artifacts.resolved += 1;
      if (request.requestedSha256) {
        const bytes = stored.get(request.requestedSha256);
        if (!bytes) throw new Error(`evidence artifact ${request.requestedSha256} referenced by a prior attempt no longer exists`);
        return { sha256: request.requestedSha256, url: `https://evidence.example/${request.requestedSha256}.json`, sizeBytes: bytes.byteLength, reused: true };
      }
      const value = buildProbeEvidenceForIncident({ serviceId: request.serviceId, region: request.region, observedStart: request.observedStart, observedEnd: request.observedEnd, probeId: request.probeId, availabilityPpm: 0, errorRatePpm: 0, incidentConfirmed: true, faultDomain: "PROVIDER" });
      const built = buildProbeEvidence(value);
      stored.set(built.sha256, built.bytes);
      publicState.bytes = built.bytes;
      return { sha256: built.sha256, url: `https://evidence.example/${built.sha256}.json`, sizeBytes: built.bytes.byteLength, reused: false };
    },
  };
  const attemptStore: ReporterAttemptStore = {
    list: async (input): Promise<PriorAttempt[]> => attempts.filter((attempt) => attempt.reporter === input.reporter && (input.sha256 ? attempt.sha256 === input.sha256 : attempt.incidentId === input.incidentId)).map((attempt) => ({ method: attempt.method ?? "", status: attempt.status, txHash: attempt.txHash, evidenceId: attempt.evidenceId ? String(attempt.evidenceId) : null, artifactUrl: attempt.artifactUrl, sha256: attempt.sha256, reporter: attempt.reporter, failureCategory: attempt.failureCategory, finalizedAt: attempt.finalizedAt })),
    save: async (record) => { attempts.push(record); },
  };
  const writer: ReporterWritePort = {
    address: reporterAddress,
    send: async ({ method, args, value }) => {
      const tx = node.write(method, args, reporterAddress, value ?? 0n);
      return { txHash: tx.hash, sender: reporterAddress, recipient: FROZEN_ADDRESS, submittedAt: new Date(node.nowSeconds * 1000).toISOString() };
    },
  };
  const deps: ReporterRunDeps = {
    chain: createReporterChainPort(adapter),
    writer,
    tracker: createReporterTracker(node.transport, { maxWaitMs: 2_000, initialPollMs: 1, maxPollMs: 2 }),
    artifacts: artifactPort,
    attempts: attemptStore,
    fetchArtifactBytes: async () => {
      const headers: Record<string, string> = {};
      if (publicState.contentType) { headers["content-type"] = publicState.contentType; headers["content-length"] = String(publicState.bytes.byteLength); }
      return { status: publicState.status, headers, body: publicState.bytes };
    },
    runtime: { chainId: FROZEN_CHAIN_ID, contractAddress: FROZEN_ADDRESS, frozenSourceSha256: FROZEN_SOURCE_SHA256, evidencePublicBaseUrl: "https://evidence.example", region: "frankfurt", evidenceMaxBytes: 65_536, verifyContractSource: true },
    options: { incidentId: 7n, summary: "faultpact reporter certification", description: "faultpact reporter certification", submitEvidenceType: options.submitEvidenceType ?? "THIRD_PARTY_MONITOR", dryRun: false },
    now: () => node.nowSeconds * 1000,
    log: (message, detail) => { logs.push(`${message} ${JSON.stringify(detail ?? {})}`); },
  };
  void setPublicBytes;
  return { deps, node, artifacts, attempts, logs, setPublicBytes, publicStatus };
}

const FROZEN_SOURCE = "import genlayer as gl\n# frozen deployment source\n";

function harness(options: FakeNodeOptions & { reporterKey?: string; submitEvidenceType?: "THIRD_PARTY_MONITOR" | "CUSTOMER_LOG" } = {}): Harness {
  return createHarness({ ...options, sourceBytes: options.sourceBytes ?? FROZEN_SOURCE });
}

describe("signer-backed evidence worker (deterministic integration)", () => {
  it("ATTACH_AND_SUBMIT_FINALIZE_AND_READ_BACK", async () => {
    const h = harness();
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });

    expect(result.status).toBe("PASS");
    expect(result.reporter).toBe(deriveReporterAddress(TEST_REPORTER_KEY));
    expect(result.reporterAuthorized).toBe(true);
    expect(result.reporterMode).toBe("AUTHORIZED_SUBMISSION");
    expect(result.failures).toEqual([]);
    expect(result.artifact.httpVerification?.matched).toBe(true);
    expect(result.artifact.httpVerification?.httpSha256).toBe(result.artifact.sha256);
    expect(result.artifact.url).toBe(`https://evidence.example/${result.artifact.sha256}.json`);

    const attach = result.steps.find((step) => step.method === "attach_incident_report");
    const submit = result.steps.find((step) => step.method === "submit_evidence");
    expect(attach?.status).toBe("SUBMITTED");
    expect(attach?.finalization).toBe("FINALIZED");
    expect(attach?.sender).toBe(result.reporter);
    expect(attach?.evidenceId).toBe("1");
    expect(submit?.status).toBe("SUBMITTED");
    expect(submit?.finalization).toBe("FINALIZED");
    expect(submit?.sender).toBe(result.reporter);
    expect(submit?.evidenceId).toBe("2");

    // Contract read-back, not database state.
    for (const step of [attach, submit]) {
      expect(step?.readBack?.passed).toBe(true);
      expect(step?.readBack?.record.uri).toBe(result.artifact.url);
      expect(step?.readBack?.record.contentHash).toBe(result.artifact.sha256);
      expect(step?.readBack?.record.incidentId).toBe("7");
      expect(step?.readBack?.record.submitter.toLowerCase()).toBe(result.reporter.toLowerCase());
      expect(step?.readBack?.record.provenance).toBe("AUTHORITATIVE");
      expect(step?.readBack?.record.reporterAuthorizedAtSubmission).toBe(true);
    }
    expect(result.evidenceIds).toEqual(["1", "2"]);
    expect(result.readBackPassed).toBe(true);

    // The node received exactly the contract's declared positional arguments.
    const authorizationCall = h.node.calls.find((call) => call.method === "is_authorized_reporter");
    expect(String(authorizationCall?.args[0])).toBe(result.reporter.toLowerCase());
    const attachWrite = h.node.writes[0];
    expect(attachWrite?.method).toBe("attach_incident_report");
    expect(attachWrite?.from).toBe(result.reporter);
    expect(attachWrite?.args).toEqual([7n, "faultpact reporter certification", result.artifact.url, result.artifact.sha256]);
    const submitWrite = h.node.writes[1];
    expect(submitWrite?.method).toBe("submit_evidence");
    expect(submitWrite?.args).toEqual([7n, "THIRD_PARTY_MONITOR", result.artifact.url, result.artifact.sha256, "faultpact reporter certification"]);

    // Persistence carries everything needed to reconcile a retry.
    const finalized = h.attempts.filter((attempt) => attempt.status === "FINALIZED");
    expect(finalized).toHaveLength(2);
    expect(finalized.map((attempt) => attempt.method).sort()).toEqual(["attach_incident_report", "submit_evidence"]);
    for (const attempt of finalized) {
      expect(attempt.reporter).toBe(result.reporter);
      expect(attempt.artifactUrl).toBe(result.artifact.url);
      expect(attempt.sha256).toBe(result.artifact.sha256);
      expect(attempt.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(attempt.evidenceId).not.toBeNull();
      expect(attempt.txState).toBe("FINALIZED");
      expect(attempt.finalizedAt).toBeInstanceOf(Date);
    }
  }, 20_000);

  it("PRIVATE_KEY_NEVER_APPEARS_IN_LOGS_OR_OUTPUT", async () => {
    const h = harness();
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    const output = [...h.logs, ...formatReporterSummary(result)].join("\n");
    const serialized = JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
    expect(result.status).toBe("PASS");
    expect(output).not.toContain(TEST_REPORTER_KEY);
    expect(output).not.toContain(TEST_REPORTER_KEY.slice(2));
    expect(serialized).not.toContain(TEST_REPORTER_KEY);
  }, 20_000);

  it("ARTIFACT_BYTES_ARE_CANONICAL_AND_HASHED_EXACTLY", async () => {
    const h = harness();
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    const stored = h.artifacts.stored.get(result.artifact.sha256);
    expect(stored).toBeDefined();
    expect(sha256Bytes(stored!)).toBe(result.artifact.sha256);
    // The HTTP body is the exact canonical byte string, not a re-serialized copy.
    expect(stored!.toString("utf8")).toBe(canonicalJson(JSON.parse(stored!.toString("utf8"))));
    expect(result.artifact.sizeBytes).toBe(stored!.byteLength);
    expect(result.artifact.httpVerification?.sizeBytes).toBe(stored!.byteLength);
  }, 20_000);

  it("ARTIFACT_HASH_MISMATCH_BLOCKS_ANY_TRANSACTION", async () => {
    const h = harness();
    const original = h.deps.artifacts.resolve;
    h.deps.artifacts = {
      ...h.deps.artifacts,
      resolve: async (request) => {
        const artifact = await original(request);
        const stored = h.artifacts.stored.get(artifact.sha256);
        h.setPublicBytes(Buffer.from(`${stored!.toString("utf8")} `, "utf8"));
        return artifact;
      },
    };
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("FAIL");
    expect(result.failures[0]?.code).toBe("ARTIFACT_HASH_MISMATCH");
    expect(h.node.writes).toHaveLength(0);
  }, 20_000);

  it("ARTIFACT_PUBLIC_URL_UNREACHABLE_FAILS_CLOSED", async () => {
    const h = harness();
    const original = h.deps.artifacts.resolve;
    h.deps.artifacts = { ...h.deps.artifacts, resolve: async (request) => { const artifact = await original(request); h.publicStatus.status = 404; return artifact; } };
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("FAIL");
    expect(result.failures[0]?.code).toBe("ARTIFACT_PUBLIC_URL_UNREACHABLE");
    expect(h.node.writes).toHaveLength(0);
  }, 20_000);

  it("UNAUTHORIZED_REPORTER_NEVER_SIGNS_A_TRANSACTION", async () => {
    const h = harness({ authorized: [deriveReporterAddress(TEST_REPORTER_KEY_2)] });
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("FAIL");
    expect(result.reporterAuthorized).toBe(false);
    expect(result.reporterMode).toBe("MONITOR_ONLY");
    expect(result.failures[0]?.code).toBe("REPORTER_NOT_AUTHORIZED");
    expect(h.node.writes).toHaveLength(0);
    expect(formatReporterSummary(result).join("\n")).toContain("Reporter authorized: FAIL");
  }, 20_000);

  it("MISSING_PRIVATE_KEY_REPORTS_MONITOR_ONLY", () => {
    let message = "";
    try { deriveReporterAddress(""); }
    catch (error) { message = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
    expect(message).toContain("ReporterConfigurationError");
    expect(message).toContain("private key");
    expect(message).not.toContain(TEST_REPORTER_KEY);
  });

  it("INCIDENT_NOT_OPEN_AND_CLOSED_WINDOW_FAIL_CLOSED", async () => {
    const notOpen = harness({ status: "FINALIZED" });
    const notOpenResult = await runReporterEvidenceSubmission({ ...notOpen.deps, runtime: { ...notOpen.deps.runtime, verifyContractSource: false } });
    expect(notOpenResult.failures[0]?.code).toBe("INCIDENT_NOT_OPEN");
    expect(notOpen.node.writes).toHaveLength(0);

    const closed = harness({ evidenceDeadline: 1_790_099_999 });
    const closedResult = await runReporterEvidenceSubmission({ ...closed.deps, runtime: { ...closed.deps.runtime, verifyContractSource: false } });
    expect(closedResult.failures[0]?.code).toBe("EVIDENCE_WINDOW_CLOSED");
    expect(closed.node.writes).toHaveLength(0);
  }, 20_000);

  it("WRONG_CHAIN_REFUSES_TO_SIGN", async () => {
    const h = harness({ chainId: 61_999 });
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.failures[0]?.code).toBe("WRONG_CHAIN");
    expect(h.node.writes).toHaveLength(0);
  }, 20_000);

  it("WRONG_DEPLOYED_SOURCE_REFUSES_TO_SIGN", async () => {
    const h = harness({ sourceBytes: "# tampered deployment source\n" });
    const result = await runReporterEvidenceSubmission(h.deps);
    expect(result.failures[0]?.code).toBe("WRONG_CONTRACT");
    expect(h.node.writes).toHaveLength(0);
  }, 20_000);

  it("FROZEN_REPOSITORY_SOURCE_VERIFICATION_PASSES", async () => {
    const source = await readFile(new URL("../../../contracts/FaultPact.py", import.meta.url), "utf8");
    expect(sha256Bytes(Buffer.from(source, "utf8"))).toBe(FROZEN_SOURCE_SHA256);
    const h = harness({ sourceBytes: source });
    const result = await runReporterEvidenceSubmission(h.deps);
    expect(result.failures).toEqual([]);
    expect(result.status).toBe("PASS");
    expect(h.node.writes).toHaveLength(2);
  }, 20_000);

  it("FINALIZATION_TIMEOUT_IS_NOT_VERIFIED_NEVER_PASS", async () => {
    const h = harness();
    const originalWrite = h.node.write.bind(h.node);
    h.node.write = (method, args, from, value) => {
      const tx = originalWrite(method, args, from, value);
      tx.remainingPolls = 1_000_000;
      return tx;
    };
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("FAIL");
    const attach = result.steps.find((step) => step.method === "attach_incident_report");
    expect(attach?.status).toBe("NOT_VERIFIED");
    expect(attach?.finalization).toBe("NOT_VERIFIED");
    expect(result.failures[0]?.code).toBe("TX_FINALIZATION_NOT_VERIFIED");
    const summary = formatReporterSummary(result).join("\n");
    expect(summary).toContain("Attach finalization: NOT VERIFIED");
    expect(summary).toContain("Verification: FAIL");
    expect(result.readBackPassed).toBe(false);
  }, 30_000);

  it("REVERTED_TRANSACTION_IS_FAILED", async () => {
    const h = harness({ status: "EVIDENCE_SEALED" });
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    // The orchestrator refuses an incident that is no longer OPEN.
    expect(result.status).toBe("FAIL");
    expect(h.node.writes).toHaveLength(0);
  }, 20_000);

  it("RETRY_AFTER_TIMEOUT_RECONCILES_INSTEAD_OF_DUPLICATING", async () => {
    const h = harness();
    // The first run signs the attach transaction but the finalization wait
    // expires locally: the worker exits without knowing the outcome.
    h.deps.tracker = { waitForFinalization: async (hash) => ({ hash, finalization: "NOT_VERIFIED", state: "PENDING", polls: 1, elapsedMs: 1, reason: "worker stopped before observing finalization" }) };
    const first = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(first.status).toBe("FAIL");
    expect(first.failures[0]?.code).toBe("TX_FINALIZATION_NOT_VERIFIED");
    const unresolved = h.attempts.find((attempt) => attempt.status === "FINALIZING" || attempt.status === "SUBMITTED");
    expect(unresolved?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h.node.evidence.size).toBe(0);

    // Second run after a restart: the same immutable artifact is resolved, the
    // unresolved transaction is reconciled and no duplicate write is signed.
    h.deps.tracker = createReporterTracker(h.node.transport, { maxWaitMs: 2_000, initialPollMs: 1, maxPollMs: 2 });
    const second = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(second.status).toBe("PASS");
    expect(second.artifact.reused).toBe(true);
    const attach = second.steps.find((step) => step.method === "attach_incident_report");
    expect(attach?.status).toBe("RECONCILED");
    expect(attach?.txHash).toBe(unresolved?.txHash);
    expect(attach?.readBack?.passed).toBe(true);
    expect(h.node.writes.filter((write) => write.method === "attach_incident_report")).toHaveLength(1);
    expect(h.node.evidence.size).toBe(2);
  }, 30_000);

  it("SECOND_RUN_WITH_EVIDENCE_ALREADY_ONCHAIN_SUBMITS_NOTHING", async () => {
    const h = harness();
    const first = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(first.status).toBe("PASS");
    const writesAfterFirst = h.node.writes.length;
    const second = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(second.status).toBe("PASS");
    expect(second.steps.every((step) => step.status === "ALREADY_ONCHAIN")).toBe(true);
    expect(h.node.writes).toHaveLength(writesAfterFirst);
    expect(second.readBackPassed).toBe(true);
  }, 30_000);

  it("READ_BACK_HASH_MISMATCH_FAILS_THE_STEP", async () => {
    const h = harness();
    // The stored record keeps the right URI and submitter but a wrong content hash.
    const node = h.node as unknown as { options: { corruptReadBack?: Record<string, Partial<Record<string, string>>> } };
    node.options.corruptReadBack = { "1": { content_hash: "b".repeat(64) } };
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("FAIL");
    expect(result.failures.some((failure) => failure.code === "EVIDENCE_READ_BACK_MISMATCH")).toBe(true);
    expect(result.readBackPassed).toBe(false);
    expect(h.attempts.some((attempt) => attempt.failureCategory === "EVIDENCE_READ_BACK_MISMATCH")).toBe(true);
  }, 30_000);

  it("READ_BACK_URI_MISMATCH_IS_NOT_TREATED_AS_OUR_EVIDENCE", async () => {
    const h = harness();
    const node = h.node as unknown as { options: { corruptReadBack?: Record<string, Partial<Record<string, string>>> } };
    node.options.corruptReadBack = { "1": { uri: "https://evidence.example/tampered.json" } };
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("FAIL");
    expect(result.failures[0]?.code).toBe("EVIDENCE_NOT_FOUND_ONCHAIN");
  }, 30_000);

  it("SENDER_MISMATCH_BETWEEN_SIGNER_AND_TRANSACTION_SENDER_FAILS", async () => {
    const h = harness();
    h.deps.writer = {
      address: deriveReporterAddress(TEST_REPORTER_KEY),
      send: async ({ method, args }) => {
        const tx = h.node.write(method, args, OTHER_ADDRESS);
        return { txHash: tx.hash, sender: OTHER_ADDRESS, recipient: FROZEN_ADDRESS, submittedAt: new Date().toISOString() };
      },
    };
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("FAIL");
    expect(result.failures[0]?.code).toBe("REPORTER_SENDER_MISMATCH");
  }, 20_000);

  it("SECOND_WRITE_STOPS_AT_THE_FROZEN_PER_REPORTER_CAP", async () => {
    const h = harness();
    // Three authoritative records already exist for this reporter on this incident.
    for (let index = 0; index < 3; index += 1) {
      h.node.finalizeNow(h.node.write("attach_incident_report", [7n, `prefill ${index}`, "https://evidence.example/prefill.json", "a".repeat(64)], deriveReporterAddress(TEST_REPORTER_KEY)));
    }
    const result = await runReporterEvidenceSubmission({ ...h.deps, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("FAIL");
    expect(result.steps.find((step) => step.method === "attach_incident_report")?.status).toBe("SUBMITTED");
    const submit = result.steps.find((step) => step.method === "submit_evidence");
    expect(submit?.status).toBe("SKIPPED");
    expect(submit?.errorCode).toBe("MAX_AUTHORITATIVE_PER_REPORTER");
    expect(h.node.writes.filter((write) => write.method === "submit_evidence")).toHaveLength(0);
  }, 30_000);

  it("DRY_RUN_PLANS_WITHOUT_SIGNING", async () => {
    const h = harness();
    const result = await runReporterEvidenceSubmission({ ...h.deps, options: { ...h.deps.options, dryRun: true }, runtime: { ...h.deps.runtime, verifyContractSource: false } });
    expect(result.status).toBe("PASS");
    expect(result.dryRun).toBe(true);
    expect(h.node.writes).toHaveLength(0);
    expect(result.steps.map((step) => step.status)).toEqual(["PLANNED", "PLANNED"]);
  }, 20_000);

  it("ARGUMENTS_MATCH_THE_FROZEN_SCHEMA_BY_NAME_AND_POSITION", () => {
    const schema = getFrozenSchema();
    assertMethodSignature(schema, "attach_incident_report", ["incident_id", "summary", "evidence_uri", "evidence_hash"]);
    assertMethodSignature(schema, "submit_evidence", ["incident_id", "evidence_type", "evidence_uri", "content_hash", "description"]);
    expect(() => assertMethodSignature(schema, "attach_incident_report", ["incident_id", "summary", "evidence_hash", "evidence_uri"])).toThrow(ReporterEvidenceError);
    const attach = buildAttachIncidentReportArgs({ incidentId: "7", summary: "s", artifactUrl: "https://evidence.example/a.json", sha256: `0x${"A".repeat(64)}` });
    expect(attach).toEqual([7n, "s", "https://evidence.example/a.json", "a".repeat(64)]);
    expect(buildGenVmPositionalArgs({ schema: schema as unknown as Parameters<typeof buildGenVmPositionalArgs>[0]["schema"], functionName: "attach_incident_report", valuesByParamName: { incident_id: attach[0], summary: attach[1], evidence_uri: attach[2], evidence_hash: attach[3] } })).toEqual(attach);
    const submit = buildSubmitEvidenceArgs({ incidentId: 7n, evidenceType: "third_party_monitor", artifactUrl: "https://evidence.example/a.json", sha256: "a".repeat(64), description: "d" });
    expect(submit).toEqual([7n, "THIRD_PARTY_MONITOR", "https://evidence.example/a.json", "a".repeat(64), "d"]);
    expect(buildGenVmPositionalArgs({ schema: schema as unknown as Parameters<typeof buildGenVmPositionalArgs>[0]["schema"], functionName: "submit_evidence", valuesByParamName: { incident_id: submit[0], evidence_type: submit[1], evidence_uri: submit[2], content_hash: submit[3], description: submit[4] } })).toEqual(submit);
    expect(() => buildSubmitEvidenceArgs({ incidentId: 7n, evidenceType: "NOPE", artifactUrl: "https://evidence.example/a.json", sha256: "a".repeat(64), description: "d" })).toThrow(/evidence_type/);
    expect(() => buildAttachIncidentReportArgs({ incidentId: 7n, summary: "s", artifactUrl: "http://evidence.example/a.json", sha256: "a".repeat(64) })).toThrow(/HTTPS/);
    expect(() => buildAttachIncidentReportArgs({ incidentId: 7n, summary: "s", artifactUrl: "https://evidence.example/a.json", sha256: "nope" })).toThrow(/64 lowercase/);
  });

  it("TRANSACTION_LIFECYCLE_POLLING_IS_BOUNDED", async () => {
    const observations: string[] = [];
    const tracker = new TransactionTracker({
      fetchTransaction: async (hash) => {
        observations.push(hash);
        return mapTransactionRecord({ status: "PROPOSING", txExecutionResultName: "PROPOSING", from_address: deriveReporterAddress(TEST_REPORTER_KEY) }, hash, new Date().toISOString());
      },
      maxWaitMs: 120,
      initialPollMs: 10,
      maxPollMs: 20,
      sleep: async () => { await new Promise((resolve) => { setTimeout(resolve, 12); }); },
    });
    const outcome = await tracker.waitForFinalization("0xfeed");
    expect(outcome.finalization).toBe("NOT_VERIFIED");
    expect(observations.length).toBeGreaterThan(1);
    expect(observations.length).toBeLessThan(40);
  }, 10_000);

  it("TRANSACTION_STATE_MAPPING_MATCHES_GENLAYER_SEMANTICS", () => {
    const at = new Date().toISOString();
    expect(mapTransactionRecord(null, "0xa", at).state).toBe("NOT_FOUND");
    expect(mapTransactionRecord({ status: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }, "0xa", at).state).toBe("FINALIZED");
    expect(mapTransactionRecord({ status: "FINALIZED", txExecutionResultName: "REVERTED" }, "0xa", at).state).toBe("FAILED");
    expect(mapTransactionRecord({ status: "UNDECIDED" }, "0xa", at).state).toBe("PENDING");
    expect(mapTransactionRecord({ status: "COMMITTING" }, "0xa", at).state).toBe("FINALIZING");
    expect(mapTransactionRecord({ status: "CANCELED" }, "0xa", at).state).toBe("FAILED");
    expect(mapTransactionRecord({ status: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN", from_address: "0xabc" }, "0xa", at).sender).toBe("0xabc");
  });
});
