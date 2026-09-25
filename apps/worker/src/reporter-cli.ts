import { createDb } from "@faultpact/db";
import { loadEnv } from "@faultpact/shared";
import { ReporterConfigurationError } from "@faultpact/contract";
import { EVIDENCE_TYPES, type EvidenceType } from "@faultpact/monitoring";
import { runReporterEvidenceSubmission, REPORTER_PRECONDITION_CODES } from "./reporter-submit.js";
import { createReporterRuntime } from "./reporter-runtime.js";
import { formatReporterSummary } from "./reporter-summary.js";

export type ReporterCliOptions = {
  incidentId: bigint;
  summary: string;
  description: string;
  evidenceType: EvidenceType;
  dryRun: boolean;
  json: boolean;
  verifyContractSource: boolean;
  maxFinalizationWaitMs: number;
};

export const USAGE = `Usage: pnpm evidence:submit --incident-id <id> [options]

Signer-backed evidence submission for the frozen FaultPact contract. Runs
attach_incident_report and submit_evidence with one canonical immutable artifact
and verifies the result from contract state.

Options:
  --incident-id <id>            OPEN onchain incident (or FAULTPACT_LIVE_TEST_INCIDENT_ID)
  --summary <text>              attach_incident_report summary (<= 2048 chars)
  --description <text>          submit_evidence description (<= 2048 chars)
  --evidence-type <type>        submit_evidence type (${EVIDENCE_TYPES.join("|")})
  --dry-run                     verify preconditions, artifact and plan without signing
  --json                        emit the machine-readable result
  --skip-contract-verification  skip the deployed source SHA re-read (chain and address checks remain)
  --max-finalization-wait-ms <n>  bounded per-transaction finalization wait (default 240000)
  --help                        show this message

The reporter private key is read from REPORTER_PRIVATE_KEY and is never printed.`;

export function parseReporterCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): ReporterCliOptions {
  const options: ReporterCliOptions = {
    incidentId: 0n,
    summary: "faultpact monitoring evidence",
    description: "faultpact monitoring evidence",
    evidenceType: "THIRD_PARTY_MONITOR",
    dryRun: false,
    json: false,
    verifyContractSource: true,
    maxFinalizationWaitMs: 240_000,
  };
  const incidentFlag = { value: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--incident-id": incidentFlag.value = value ?? ""; index += 1; break;
      case "--summary": options.summary = value ?? options.summary; index += 1; break;
      case "--description": options.description = value ?? options.description; index += 1; break;
      case "--evidence-type": options.evidenceType = (value ?? "").trim().toUpperCase() as EvidenceType; index += 1; break;
      case "--dry-run": options.dryRun = true; break;
      case "--json": options.json = true; break;
      case "--skip-contract-verification": options.verifyContractSource = false; break;
      case "--max-finalization-wait-ms": options.maxFinalizationWaitMs = Number(value ?? ""); index += 1; break;
      default:
        if (flag === "--help" || flag === "-h") throw new ReporterConfigurationError("HELP", USAGE);
        if (flag !== undefined && flag.startsWith("--")) throw new ReporterConfigurationError("UNKNOWN_FLAG", `Unknown option ${flag}\n\n${USAGE}`);
    }
  }
  const incidentRaw = incidentFlag.value.trim() || String(env.FAULTPACT_LIVE_TEST_INCIDENT_ID ?? "").trim();
  if (!/^\d+$/.test(incidentRaw)) throw new ReporterConfigurationError(REPORTER_PRECONDITION_CODES.missingIncident, `Set --incident-id or FAULTPACT_LIVE_TEST_INCIDENT_ID to an OPEN incident\n\n${USAGE}`);
  options.incidentId = BigInt(incidentRaw);
  if (!(EVIDENCE_TYPES as readonly string[]).includes(options.evidenceType)) throw new ReporterConfigurationError("INVALID_EVIDENCE_TYPE", `--evidence-type must be one of ${EVIDENCE_TYPES.join(", ")}`);
  if (!Number.isInteger(options.maxFinalizationWaitMs) || options.maxFinalizationWaitMs < 5_000) throw new ReporterConfigurationError("INVALID_FINALIZATION_WAIT", "--max-finalization-wait-ms must be an integer of at least 5000");
  return options;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: ReporterCliOptions;
  try {
    options = parseReporterCliArgs(argv);
  } catch (error) {
    process.stdout.write(`${error instanceof ReporterConfigurationError ? error.message : String(error)}\n`);
    return error instanceof ReporterConfigurationError && error.code === "HELP" ? 0 : 2;
  }
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  let runtime: Awaited<ReturnType<typeof createReporterRuntime>> | undefined;
  try {
    runtime = await createReporterRuntime({ env, db, verifyContractSource: options.verifyContractSource, trackOptions: { maxWaitMs: options.maxFinalizationWaitMs }, log: (message, detail) => process.stderr.write(`[reporter] ${message} ${JSON.stringify(detail ?? {})}\n`) });
    runtime.deps.options = { incidentId: options.incidentId, summary: options.summary, description: options.description, submitEvidenceType: options.evidenceType, dryRun: options.dryRun };
    const result = await runReporterEvidenceSubmission(runtime.deps);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ...result, incidentId: result.incidentId.toString(), steps: result.steps.map((step) => ({ ...step, args: step.args.map((value) => (typeof value === "bigint" ? value.toString() : value)) })) }, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`);
    }
    else process.stdout.write(`${formatReporterSummary(result, { incidentId: options.incidentId.toString() }).join("\n")}\n`);
    return result.status === "PASS" ? 0 : 1;
  } catch (error) {
    const message = error instanceof ReporterConfigurationError ? error.message : error instanceof Error ? error.message : String(error);
    process.stderr.write(`${error instanceof ReporterConfigurationError && error.code === REPORTER_PRECONDITION_CODES.reporterSubmissionDisabled ? "REPORTER SUBMISSION DISABLED\n" : ""}${message}\n`);
    return 2;
  } finally {
    await runtime?.close();
    await db.$disconnect();
  }
}

process.exitCode = await main();
