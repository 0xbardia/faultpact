import {
  ATTACH_INCIDENT_REPORT,
  SUBMIT_EVIDENCE,
  ReporterEvidenceError,
  buildArtifactUrl,
  buildAttachIncidentReportArgs,
  buildSubmitEvidenceArgs,
  checkReporterEvidenceCapacity,
  isAuthoritativeType,
  parseEvidenceRecord,
  planEvidenceSubmissions,
  storedEvidenceTypeFor,
  verifyEvidenceReadBack,
  verifyPublicArtifactBytes,
  type ArtifactVerification,
  type AttachIncidentReportArgs,
  type EvidenceRecord,
  type EvidenceType,
  type PriorAttempt,
  type ReadBackVerification,
  type SubmitEvidenceArgs,
} from "@faultpact/monitoring";
import type { FinalizationOutcome } from "@faultpact/contract";

export const REPORTER_PRECONDITION_CODES = {
  reporterSubmissionDisabled: "REPORTER_SUBMISSION_DISABLED",
  reporterNotAuthorized: "REPORTER_NOT_AUTHORIZED",
  wrongChain: "WRONG_CHAIN",
  wrongContract: "WRONG_CONTRACT",
  missingIncident: "MISSING_LIVE_INCIDENT_ID",
  unknownIncident: "UNKNOWN_INCIDENT",
  incidentNotOpen: "INCIDENT_NOT_OPEN",
  evidenceWindowClosed: "EVIDENCE_WINDOW_CLOSED",
} as const;

export type StepStatus = "SUBMITTED" | "ALREADY_ONCHAIN" | "RECONCILED" | "NOT_VERIFIED" | "FAILED" | "PLANNED" | "SKIPPED";

export type StepResult = {
  method: string;
  evidenceType: EvidenceType;
  status: StepStatus;
  args: readonly unknown[];
  sender?: string;
  txHash?: string;
  txState?: string;
  finalization: "FINALIZED" | "FAILED" | "NOT_VERIFIED" | "N/A";
  evidenceId?: string;
  readBack?: ReadBackVerification;
  error?: string;
  errorCode?: string;
};

export type ReporterFailure = { code: string; message: string; step?: string };

export type ReporterSubmissionResult = {
  status: "PASS" | "FAIL";
  reporter: string;
  reporterAuthorized: boolean;
  reporterMode: "AUTHORIZED_SUBMISSION" | "MONITOR_ONLY";
  chainId: number;
  contractAddress: string;
  incidentId: bigint;
  artifact: { url: string; sha256: string; sizeBytes: number; probeId: string; reused: boolean; httpVerification?: ArtifactVerification };
  steps: StepResult[];
  evidenceIds: string[];
  readBackPassed: boolean;
  failures: ReporterFailure[];
  dryRun: boolean;
};

export type ReporterIncident = { status: string; evidenceDeadline: string; serviceId: string; summary: string };

export type ReporterChainPort = {
  chainIdFromRpc(): Promise<number>;
  verifyFrozenContract(): Promise<{ chainId: number; sourceSha256: string; sourceMatches: boolean; address: string }>;
  isAuthorizedReporter(address: string): Promise<boolean>;
  getIncident(incidentId: bigint): Promise<ReporterIncident>;
  incidentEvidenceIds(incidentId: bigint): Promise<bigint[]>;
  readEvidence(evidenceId: bigint): Promise<Record<string, unknown>>;
};

export type ReporterWritePort = {
  readonly address: string;
  send(input: { method: string; args: readonly unknown[]; value?: bigint }): Promise<{ txHash: string; sender: string; recipient: string; submittedAt: string }>;
};

export type ReporterTrackerPort = { waitForFinalization(hash: string): Promise<FinalizationOutcome> };

export type ReporterArtifactPort = {
  resolve(input: { incidentId: bigint; serviceId: number; region: string; observedStart: number; observedEnd: number; probeId: string; requestedSha256?: string }): Promise<{ sha256: string; url: string; sizeBytes: number; reused: boolean }>;
};

export type ReporterAttemptUpdate = {
  incidentId: bigint;
  sha256: string;
  artifactUrl: string;
  method: string;
  reporter: string;
  status: string;
  txHash?: string | null;
  evidenceId?: string | null;
  txState?: string | null;
  finalizedAt?: Date | null;
  failureCategory?: string | null;
  error?: string | null;
};

export type ReporterAttemptStore = {
  list(input: { incidentId: bigint; sha256: string; reporter: string }): Promise<PriorAttempt[]>;
  save(record: ReporterAttemptUpdate): Promise<void>;
};

export type ReporterRuntime = {
  chainId: number;
  contractAddress: string;
  frozenSourceSha256: string;
  evidencePublicBaseUrl: string;
  region: string;
  evidenceMaxBytes: number;
  verifyContractSource: boolean;
};

export type ReporterRunOptions = {
  incidentId: bigint;
  summary: string;
  description: string;
  submitEvidenceType: EvidenceType;
  dryRun?: boolean;
  /**
   * `sequential` signs, waits and verifies one record at a time.
   * `parallel` signs both records back to back and then waits and verifies
   * each of them. Deployments with a short evidence window cannot fit two
   * serialized finalization waits inside the window.
   */
  evidenceSubmissionStrategy?: "sequential" | "parallel";
};

export type ReporterRunDeps = {
  chain: ReporterChainPort;
  writer: ReporterWritePort;
  tracker: ReporterTrackerPort;
  artifacts: ReporterArtifactPort;
  attempts: ReporterAttemptStore;
  fetchArtifactBytes: (url: string) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
  runtime: ReporterRuntime;
  options: ReporterRunOptions;
  now?: () => number;
  log?: (message: string, detail?: Record<string, unknown>) => void;
};

function failureOf(error: unknown, step?: string, fallbackCode = "REPORTER_OPERATION_FAILED"): ReporterFailure {
  if (error instanceof ReporterEvidenceError) return { code: error.code, message: error.message, ...(step ? { step } : {}) };
  const message = error instanceof Error ? error.message : String(error);
  const code = /\b429\b|cooldown|rate[\s-]?limit|daily budget|quota/i.test(message) ? "RPC_RATE_LIMITED" : fallbackCode;
  return { code, message, ...(step ? { step } : {}) };
}

/**
 * Signer-backed evidence submission.
 *
 * frozen chain/contract -> authorized reporter preflight -> OPEN incident with a
 * live evidence window -> canonical immutable artifact -> exact HTTP byte
 * verification -> contract evidence-id snapshot -> attach_incident_report ->
 * FINALIZED -> contract read-back -> submit_evidence -> FINALIZED -> contract
 * read-back. Every step fails closed and is persisted through the existing
 * submission-attempt model so a retry never duplicates evidence.
 */
export async function runReporterEvidenceSubmission(deps: ReporterRunDeps): Promise<ReporterSubmissionResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const { runtime, options } = deps;
  const failures: ReporterFailure[] = [];
  const steps: StepResult[] = [];
  const reporter = deps.writer.address;
  const result: ReporterSubmissionResult = {
    status: "FAIL",
    reporter,
    reporterAuthorized: false,
    reporterMode: "MONITOR_ONLY",
    chainId: runtime.chainId,
    contractAddress: runtime.contractAddress,
    incidentId: options.incidentId,
    artifact: { url: "", sha256: "", sizeBytes: 0, probeId: "", reused: false },
    steps,
    evidenceIds: [],
    readBackPassed: false,
    failures,
    dryRun: options.dryRun === true,
  };

  if (runtime.chainId !== 61997) {
    failures.push({ code: REPORTER_PRECONDITION_CODES.wrongChain, message: `refusing to sign for chain ${runtime.chainId}` });
    return result;
  }
  const chainId = await deps.chain.chainIdFromRpc();
  result.chainId = chainId;
  if (chainId !== runtime.chainId) {
    failures.push({ code: REPORTER_PRECONDITION_CODES.wrongChain, message: `RPC reports chain ${chainId}, expected ${runtime.chainId}` });
    return result;
  }
  if (runtime.verifyContractSource) {
    let verification: Awaited<ReturnType<ReporterChainPort["verifyFrozenContract"]>>;
    try {
      verification = await deps.chain.verifyFrozenContract();
    } catch (error) {
      failures.push({ code: REPORTER_PRECONDITION_CODES.wrongContract, message: `frozen deployment verification failed: ${error instanceof Error ? error.message : String(error)}` });
      return result;
    }
    if (!verification.sourceMatches || verification.sourceSha256 !== runtime.frozenSourceSha256) {
      failures.push({ code: REPORTER_PRECONDITION_CODES.wrongContract, message: `deployed source ${verification.sourceSha256} is not the frozen FaultPact source` });
      return result;
    }
    if (verification.address.toLowerCase() !== runtime.contractAddress.toLowerCase()) {
      failures.push({ code: REPORTER_PRECONDITION_CODES.wrongContract, message: `deployed address ${verification.address} is not the frozen FaultPact address` });
      return result;
    }
  }

  const authorized = await deps.chain.isAuthorizedReporter(reporter);
  result.reporterAuthorized = authorized;
  if (!authorized) {
    failures.push({ code: REPORTER_PRECONDITION_CODES.reporterNotAuthorized, message: `reporter ${reporter} is not an authorized reporter in the frozen contract; no transaction was signed` });
    return result;
  }
  result.reporterMode = "AUTHORIZED_SUBMISSION";
  log("reporter preflight passed", { reporter, chainId, contractAddress: runtime.contractAddress });

  let incident: ReporterIncident;
  try {
    incident = await deps.chain.getIncident(options.incidentId);
  } catch {
    failures.push({ code: REPORTER_PRECONDITION_CODES.unknownIncident, message: `incident ${options.incidentId} could not be read from contract state` });
    return result;
  }
  if (incident.status !== "OPEN") {
    failures.push({ code: REPORTER_PRECONDITION_CODES.incidentNotOpen, message: `incident ${options.incidentId} is ${incident.status}; evidence submission requires status OPEN` });
    return result;
  }
  if (!Number.isFinite(Number(incident.evidenceDeadline)) || Number(incident.evidenceDeadline) <= Math.floor(now() / 1000)) {
    failures.push({ code: REPORTER_PRECONDITION_CODES.evidenceWindowClosed, message: `incident ${options.incidentId} evidence window closed at ${incident.evidenceDeadline}` });
    return result;
  }

  const serviceId = Number(incident.serviceId);
  if (!Number.isSafeInteger(serviceId) || serviceId < 0) {
    failures.push({ code: "INVALID_INCIDENT_SERVICE", message: `incident service id ${incident.serviceId} is not representable in the probe artifact schema` });
    return result;
  }
  const observedEnd = Math.min(Math.floor(now() / 1000), Number(incident.evidenceDeadline) - 1);
  const probeId = `reporter-${options.incidentId.toString()}-${observedEnd}`;
  const incidentAttempts = await deps.attempts.list({ incidentId: options.incidentId, sha256: "", reporter });
  const reusableSha = incidentAttempts.filter((attempt) => attempt.method && attempt.sha256).at(-1)?.sha256 ?? undefined;
  let artifact: { sha256: string; url: string; sizeBytes: number; reused: boolean };
  try {
    artifact = await deps.artifacts.resolve({
      incidentId: options.incidentId,
      serviceId,
      region: runtime.region,
      observedStart: Math.max(0, observedEnd - 300),
      observedEnd,
      probeId,
      ...(reusableSha ? { requestedSha256: reusableSha } : {}),
    });
  } catch (error) {
    failures.push(failureOf(error));
    return result;
  }
  const artifactUrl = artifact.url || buildArtifactUrl(runtime.evidencePublicBaseUrl, artifact.sha256);
  result.artifact = { url: artifactUrl, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes, probeId, reused: artifact.reused };
  log("canonical artifact resolved", { sha256: artifact.sha256, url: artifactUrl, sizeBytes: artifact.sizeBytes, reused: artifact.reused });

  try {
    result.artifact.httpVerification = await verifyPublicArtifactBytes({ url: artifactUrl, expectedSha256: artifact.sha256, maxBytes: runtime.evidenceMaxBytes, fetchBytes: deps.fetchArtifactBytes });
  } catch (error) {
    failures.push(failureOf(error));
    return result;
  }
  log("public artifact bytes verified", { httpSha256: result.artifact.httpVerification.httpSha256, sizeBytes: result.artifact.httpVerification.sizeBytes });

  let attachArgs: AttachIncidentReportArgs;
  let submitArgs: SubmitEvidenceArgs;
  let plan: Awaited<ReturnType<typeof planEvidenceSubmissions>>;
  try {
    attachArgs = buildAttachIncidentReportArgs({ incidentId: options.incidentId, summary: options.summary, artifactUrl, sha256: artifact.sha256 });
    submitArgs = buildSubmitEvidenceArgs({ incidentId: options.incidentId, evidenceType: options.submitEvidenceType, artifactUrl, sha256: artifact.sha256, description: options.description });
    plan = await planEvidenceSubmissions({
      incidentId: options.incidentId,
      artifactUrl,
      sha256: artifact.sha256,
      reporterAddress: reporter,
      attachEvidenceType: storedEvidenceTypeFor(ATTACH_INCIDENT_REPORT),
      submitEvidenceType: storedEvidenceTypeFor(SUBMIT_EVIDENCE, options.submitEvidenceType),
      existingEvidenceIds: await deps.chain.incidentEvidenceIds(options.incidentId),
      readEvidence: async (id) => parseEvidenceRecord(await deps.chain.readEvidence(id)),
      priorAttempts: await deps.attempts.list({ incidentId: options.incidentId, sha256: artifact.sha256, reporter }),
    });
  } catch (error) {
    failures.push(failureOf(error));
    return result;
  }
  log("submission plan resolved", { submit: plan.submit, alreadyOnchain: plan.alreadyOnchain, reconcile: plan.reconcile });

  const strategy = options.evidenceSubmissionStrategy ?? "sequential";
  const alreadyOnchain = await resolveAlreadyOnchainSteps(deps, { plan, argsFor: (method) => (method === ATTACH_INCIDENT_REPORT ? attachArgs : submitArgs), reporter, artifactUrl, artifactSha256: artifact.sha256, failures, steps });
  if (options.dryRun) {
    for (const step of plan.steps) {
      if (alreadyOnchain.has(step.method)) continue;
      steps.push({ method: step.method, evidenceType: step.evidenceType, status: "PLANNED", args: step.method === ATTACH_INCIDENT_REPORT ? attachArgs : submitArgs, sender: reporter, finalization: "N/A" });
    }
    result.evidenceIds = (await deps.chain.incidentEvidenceIds(options.incidentId)).map((id) => id.toString());
    result.readBackPassed = failures.length === 0 && steps.filter((step) => step.status === "ALREADY_ONCHAIN").every((step) => step.readBack?.passed === true);
    result.status = failures.length === 0 ? "PASS" : "FAIL";
    return result;
  }

  const pending = plan.steps.filter((step) => !alreadyOnchain.has(step.method));
  if (pending.length > 0) {
    const authoritativePending = pending.filter((step) => isAuthoritativeType(step.evidenceType)).length;
    for (const step of pending) {
      if (step.method !== SUBMIT_EVIDENCE) continue;
      const blocked = await secondWritePrecondition(deps, { reporter, evidenceType: step.evidenceType, pendingOfSameProvenance: isAuthoritativeType(step.evidenceType) ? authoritativePending : pending.length - authoritativePending });
      if (blocked) {
        failures.push(blocked);
        steps.push({ method: step.method, evidenceType: step.evidenceType, status: "SKIPPED", args: submitArgs, sender: reporter, finalization: "N/A", error: blocked.message, errorCode: blocked.code });
      }
    }
    const blockedMethods = new Set(steps.filter((step) => step.status === "SKIPPED").map((step) => step.method));
    const writable = pending.filter((step) => !blockedMethods.has(step.method));
    const preWriteIds = new Set((await deps.chain.incidentEvidenceIds(options.incidentId)).map((id) => id.toString()));
    if (strategy === "parallel") {
      // Short evidence windows make serialized finalization waits impossible on
      // some Studio deployments, so both records are signed back to back and
      // then each is waited on and read back individually.
      const sent: Array<{ step: typeof writable[number]; submission: { txHash: string; sender: string } | undefined }> = [];
      for (const step of writable) {
        const args = step.method === ATTACH_INCIDENT_REPORT ? attachArgs : submitArgs;
        const submission = step.reconcileTxHash ? { txHash: step.reconcileTxHash, sender: reporter } : await sendStep(deps, { step, args, reporter, artifactUrl, artifactSha256: artifact.sha256, failures });
        sent.push({ step, submission });
      }
      for (const entry of sent) {
        if (!entry.submission) continue;
        const args = entry.step.method === ATTACH_INCIDENT_REPORT ? attachArgs : submitArgs;
        steps.push(await settleStep(deps, { step: entry.step, args, reporter, artifactUrl, artifactSha256: artifact.sha256, txHash: entry.submission.txHash, sender: entry.submission.sender, reconciled: entry.step.reconcileTxHash !== undefined, preWriteIds, failures }));
      }
    }
    else {
      for (const step of writable) {
        const args = step.method === ATTACH_INCIDENT_REPORT ? attachArgs : submitArgs;
        const submission = step.reconcileTxHash ? { txHash: step.reconcileTxHash, sender: reporter } : await sendStep(deps, { step, args, reporter, artifactUrl, artifactSha256: artifact.sha256, failures });
        if (!submission) break;
        const stepResult = await settleStep(deps, { step, args, reporter, artifactUrl, artifactSha256: artifact.sha256, txHash: submission.txHash, sender: submission.sender, reconciled: step.reconcileTxHash !== undefined, preWriteIds, failures });
        steps.push(stepResult);
        if (stepResult.status === "FAILED" || stepResult.status === "NOT_VERIFIED") break;
      }
    }
  }
  result.evidenceIds = await deps.chain.incidentEvidenceIds(options.incidentId).then((ids) => ids.map((id) => id.toString())).catch(() => []);
  const attach = steps.find((step) => step.method === ATTACH_INCIDENT_REPORT);
  const submit = steps.find((step) => step.method === SUBMIT_EVIDENCE);
  result.readBackPassed = [attach, submit].every((step) => step?.readBack?.passed === true);
  result.status = failures.length === 0 && result.readBackPassed ? "PASS" : "FAIL";
  return result;
}

async function secondWritePrecondition(deps: ReporterRunDeps, input: { reporter: string; evidenceType: EvidenceType; pendingOfSameProvenance: number }): Promise<ReporterFailure | undefined> {
  const live = await deps.chain.getIncident(deps.options.incidentId);
  const now = deps.now ? deps.now() : Date.now();
  if (live.status !== "OPEN") return { code: REPORTER_PRECONDITION_CODES.incidentNotOpen, message: `incident ${deps.options.incidentId} left OPEN (${live.status}) before ${SUBMIT_EVIDENCE}`, step: SUBMIT_EVIDENCE };
  if (Number(live.evidenceDeadline) <= Math.floor(now / 1000)) return { code: REPORTER_PRECONDITION_CODES.evidenceWindowClosed, message: `incident ${deps.options.incidentId} evidence window closed before ${SUBMIT_EVIDENCE}`, step: SUBMIT_EVIDENCE };
  const records: EvidenceRecord[] = [];
  for (const id of await deps.chain.incidentEvidenceIds(deps.options.incidentId)) records.push(parseEvidenceRecord(await deps.chain.readEvidence(id)));
  // Records this run is about to write also consume the reporter's per-provenance
  // quota, so they are counted as pending rather than discovered only after the
  // contract has already rejected the write.
  const capacity = checkReporterEvidenceCapacity({ records, reporterAddress: input.reporter, evidenceType: input.evidenceType, pending: input.pendingOfSameProvenance });
  if (capacity) return { code: capacity.code, message: `reporter already has ${capacity.existing} ${input.evidenceType} record(s) for incident ${deps.options.incidentId}; the frozen per-reporter limit is ${capacity.limit}`, step: SUBMIT_EVIDENCE };
  return undefined;
}

/** Verifies and records every step whose evidence already exists onchain. */
async function resolveAlreadyOnchainSteps(deps: ReporterRunDeps, input: { plan: { steps: Array<{ method: string; evidenceType: EvidenceType; alreadyOnchain?: { evidenceId: string; record: EvidenceRecord } }> }; argsFor: (method: string) => readonly unknown[]; reporter: string; artifactUrl: string; artifactSha256: string; failures: ReporterFailure[]; steps: StepResult[] }): Promise<Set<string>> {
  const resolved = new Set<string>();
  for (const step of input.plan.steps) {
    if (!step.alreadyOnchain) continue;
    const args = input.argsFor(step.method);
    try {
      const readBack = verifyEvidenceReadBack(step.alreadyOnchain.record, { incidentId: deps.options.incidentId, artifactUrl: input.artifactUrl, sha256: input.artifactSha256, reporterAddress: input.reporter, evidenceType: step.evidenceType, expectReporterAuthorized: true });
      input.steps.push({ method: step.method, evidenceType: step.evidenceType, status: "ALREADY_ONCHAIN", args, sender: step.alreadyOnchain.record.submitter, finalization: "N/A", evidenceId: step.alreadyOnchain.evidenceId, readBack });
      resolved.add(step.method);
    } catch (error) {
      const failure = failureOf(error, step.method);
      input.failures.push(failure);
      input.steps.push({ method: step.method, evidenceType: step.evidenceType, status: "FAILED", args, sender: input.reporter, finalization: "N/A", evidenceId: step.alreadyOnchain.evidenceId, error: failure.message, errorCode: failure.code });
    }
  }
  return resolved;
}

/** Signs one contract write and persists the attempt before any waiting. */
async function sendStep(deps: ReporterRunDeps, input: { step: { method: string; evidenceType: EvidenceType }; args: readonly unknown[]; reporter: string; artifactUrl: string; artifactSha256: string; failures: ReporterFailure[] }): Promise<{ txHash: string; sender: string } | undefined> {
  try {
    const sent = await deps.writer.send({ method: input.step.method, args: input.args, value: 0n });
    await deps.attempts.save({ incidentId: deps.options.incidentId, sha256: input.artifactSha256, artifactUrl: input.artifactUrl, method: input.step.method, reporter: input.reporter, status: "SUBMITTED", txHash: sent.txHash, txState: "SUBMITTED", failureCategory: null, error: null });
    return { txHash: sent.txHash, sender: sent.sender };
  } catch (error) {
    const failure = failureOf(error, input.step.method, "REPORTER_TX_SUBMIT_FAILED");
    input.failures.push(failure);
    await deps.attempts.save({ incidentId: deps.options.incidentId, sha256: input.artifactSha256, artifactUrl: input.artifactUrl, method: input.step.method, reporter: input.reporter, status: "FAILED", txHash: null, txState: null, failureCategory: failure.code, error: failure.message });
    return undefined;
  }
}

/** Waits for one signed write to finalize and verifies its contract read-back. */
async function settleStep(deps: ReporterRunDeps, input: { step: { method: string; evidenceType: EvidenceType }; args: readonly unknown[]; reporter: string; artifactUrl: string; artifactSha256: string; txHash: string; sender: string; reconciled?: boolean; preWriteIds: Set<string>; failures: ReporterFailure[] }): Promise<StepResult> {
  const { step, args, reporter, artifactUrl, artifactSha256, txHash, preWriteIds, failures } = input;
  const base: StepResult = { method: step.method, evidenceType: step.evidenceType, status: input.reconciled ? "RECONCILED" : "SUBMITTED", args, sender: input.sender, finalization: "NOT_VERIFIED", txHash };
  const outcome = await deps.tracker.waitForFinalization(txHash);
  base.txState = outcome.state;
  base.finalization = outcome.finalization;
  if (outcome.finalization !== "FINALIZED") {
    const failure: ReporterFailure = { code: outcome.finalization === "NOT_VERIFIED" ? "TX_FINALIZATION_NOT_VERIFIED" : "TX_FINALIZED_FAILED", message: `${step.method} transaction ${txHash} did not finalize successfully (${outcome.finalization}${outcome.reason ? `: ${outcome.reason}` : ""})`, step: step.method };
    failures.push(failure);
    await deps.attempts.save({ incidentId: deps.options.incidentId, sha256: artifactSha256, artifactUrl, method: step.method, reporter, status: outcome.finalization === "FAILED" ? "FAILED" : "SUBMITTED", txHash, txState: outcome.state, failureCategory: failure.code, error: failure.message });
    return { ...base, status: outcome.finalization === "FAILED" ? "FAILED" : "NOT_VERIFIED", error: failure.message, errorCode: failure.code };
  }
  if (outcome.observation?.sender && outcome.observation.sender.toLowerCase() !== reporter.toLowerCase()) {
    const failure: ReporterFailure = { code: "REPORTER_SENDER_MISMATCH", message: `transaction sender ${outcome.observation.sender} is not the configured reporter ${reporter}`, step: step.method };
    failures.push(failure);
    return { ...base, status: "FAILED", error: failure.message, errorCode: failure.code };
  }
  let evidenceId: string | undefined;
  let readBack: ReadBackVerification | undefined;
  let readBackError: ReporterFailure | undefined;
  for (const id of await deps.chain.incidentEvidenceIds(deps.options.incidentId)) {
    if (preWriteIds.has(id.toString())) continue;
    const record = parseEvidenceRecord(await deps.chain.readEvidence(id));
    if (record.submitter.toLowerCase() !== reporter.toLowerCase()) continue;
    if (record.evidenceType.trim().toUpperCase() !== step.evidenceType) continue;
    if (record.uri !== artifactUrl) continue;
    evidenceId = record.id;
    try {
      readBack = verifyEvidenceReadBack(record, { incidentId: deps.options.incidentId, artifactUrl, sha256: artifactSha256, reporterAddress: reporter, evidenceType: step.evidenceType, expectReporterAuthorized: true });
    } catch (error) {
      readBackError = failureOf(error, step.method, "EVIDENCE_READ_BACK_MISMATCH");
    }
    break;
  }
  if (!evidenceId) {
    const failure: ReporterFailure = { code: "EVIDENCE_NOT_FOUND_ONCHAIN", message: `${step.method} finalized but no matching evidence record for incident ${deps.options.incidentId} is readable from contract state`, step: step.method };
    failures.push(failure);
    await deps.attempts.save({ incidentId: deps.options.incidentId, sha256: artifactSha256, artifactUrl, method: step.method, reporter, status: "FINALIZED", txHash, txState: outcome.state, finalizedAt: new Date(), failureCategory: failure.code, error: failure.message });
    return { ...base, status: "FAILED", error: failure.message, errorCode: failure.code };
  }
  if (readBackError) {
    failures.push(readBackError);
    await deps.attempts.save({ incidentId: deps.options.incidentId, sha256: artifactSha256, artifactUrl, method: step.method, reporter, status: "FINALIZED", txHash, txState: outcome.state, evidenceId, finalizedAt: new Date(), failureCategory: readBackError.code, error: readBackError.message });
    return { ...base, status: "FAILED", evidenceId, error: readBackError.message, errorCode: readBackError.code };
  }
  await deps.attempts.save({ incidentId: deps.options.incidentId, sha256: artifactSha256, artifactUrl, method: step.method, reporter, status: "FINALIZED", txHash, txState: outcome.state, evidenceId, finalizedAt: new Date(), failureCategory: null, error: null });
  return { ...base, status: base.status, evidenceId, readBack };
}
