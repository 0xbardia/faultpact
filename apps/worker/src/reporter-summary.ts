import type { ReporterSubmissionResult, StepResult } from "./reporter-submit.js";

const PASS = "PASS";
const FAIL = "FAIL";
const NOT_VERIFIED = "NOT VERIFIED";
const NOT_CONFIGURED = "NOT CONFIGURED";

function stepOf(result: ReporterSubmissionResult, method: string): StepResult | undefined {
  return result.steps.find((step) => step.method === method);
}

function verdict(condition: boolean): string {
  return condition ? PASS : FAIL;
}

function finalizationVerdict(step: StepResult | undefined): string {
  if (!step) return NOT_VERIFIED;
  if (step.status === "ALREADY_ONCHAIN") return "PASS (already onchain)";
  if (step.finalization === "FINALIZED") return PASS;
  if (step.finalization === "FAILED") return FAIL;
  return NOT_VERIFIED;
}

export type ReporterSummaryOptions = { incidentId?: string };

/**
 * Concise operator summary. The reporter private key is never part of this
 * output; only the derived public address is reported.
 */
export function formatReporterSummary(result: ReporterSubmissionResult, options: ReporterSummaryOptions = {}): string[] {
  const lines: string[] = [];
  lines.push(`Chain: ${result.chainId}`);
  lines.push(`Contract: ${result.contractAddress}`);
  lines.push(`Reporter: ${result.reporter}`);
  lines.push(`Reporter authorized: ${verdict(result.reporterAuthorized)}`);
  lines.push(`Reporter mode: ${result.reporterMode === "AUTHORIZED_SUBMISSION" ? "AUTHORIZED REPORTER SUBMISSION" : "MONITOR-ONLY"}`);
  lines.push(`Incident: ${options.incidentId ?? result.incidentId.toString()}`);
  lines.push(`Artifact URL: ${result.artifact.url || NOT_CONFIGURED}`);
  lines.push(`SHA-256: ${result.artifact.sha256 || NOT_CONFIGURED}`);
  lines.push(`Artifact bytes: ${result.artifact.sizeBytes}`);
  const http = result.artifact.httpVerification;
  lines.push(`HTTP byte/hash verification: ${http ? `${PASS} (sha256 ${http.httpSha256}, ${http.contentType})` : NOT_VERIFIED}`);

  const attach = stepOf(result, "attach_incident_report");
  const submit = stepOf(result, "submit_evidence");
  lines.push(`Attach arguments: ${attach ? JSON.stringify(attach.args.map((value) => (typeof value === "bigint" ? value.toString() : value))) : NOT_VERIFIED}`);
  lines.push(`Attach sender: ${attach?.sender ?? NOT_VERIFIED}`);
  lines.push(`Attach tx: ${attach?.txHash ?? NOT_CONFIGURED}`);
  lines.push(`Attach finalization: ${finalizationVerdict(attach)}`);
  lines.push(`Attach evidence id: ${attach?.evidenceId ?? NOT_CONFIGURED}`);
  lines.push(`Submit arguments: ${submit ? JSON.stringify(submit.args.map((value) => (typeof value === "bigint" ? value.toString() : value))) : NOT_VERIFIED}`);
  lines.push(`Submit sender: ${submit?.sender ?? NOT_VERIFIED}`);
  lines.push(`Submit tx: ${submit?.txHash ?? NOT_CONFIGURED}`);
  lines.push(`Submit finalization: ${finalizationVerdict(submit)}`);
  lines.push(`Submit evidence id: ${submit?.evidenceId ?? NOT_CONFIGURED}`);
  lines.push(`Evidence IDs: ${result.evidenceIds.length ? result.evidenceIds.join(", ") : "none"}`);

  const records = [attach?.readBack?.record, submit?.readBack?.record].filter((record): record is NonNullable<typeof record> => record !== undefined);
  lines.push(`Contract read-back: ${records.length === 0 ? NOT_VERIFIED : verdict(records.every((record) => record !== undefined))}`);
  lines.push(`Read-back URI match: ${records.length ? verdict(records.every((record) => record.uri === result.artifact.url)) : NOT_VERIFIED}`);
  lines.push(`Read-back SHA match: ${records.length ? verdict(records.every((record) => record.contentHash.toLowerCase().replace(/^0x/, "") === result.artifact.sha256)) : NOT_VERIFIED}`);
  lines.push(`Read-back sender match: ${records.length ? verdict(records.every((record) => record.submitter.toLowerCase() === result.reporter.toLowerCase())) : NOT_VERIFIED}`);
  const provenances = records.map((record) => record.provenance);
  lines.push(`Provenance: ${provenances.length ? provenances.join(", ") : NOT_VERIFIED}`);
  lines.push(`Reporter authorized at submission: ${records.length ? verdict(records.every((record) => record.reporterAuthorizedAtSubmission)) : NOT_VERIFIED}`);

  for (const failure of result.failures) lines.push(`Failure [${failure.code}${failure.step ? `/${failure.step}` : ""}]: ${failure.message}`);
  lines.push(`Verification: ${verdict(result.status === "PASS")}`);
  if (result.dryRun) lines.push("Mode: DRY RUN (no transaction was signed)");
  return lines;
}
