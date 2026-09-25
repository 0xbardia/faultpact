import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@faultpact/db";
import { loadEnv, FROZEN_CHAIN_ID, FROZEN_CONTRACT_ADDRESS, FROZEN_SOURCE_SHA256, FROZEN_RPC_URL } from "@faultpact/shared";
import { buildOpenIncidentArgs, EVIDENCE_TYPES, type EvidenceType } from "@faultpact/monitoring";
import { ReporterConfigurationError, REPORTER_KEY_PATTERN } from "@faultpact/contract";
import { createReporterRuntime, createReporterTracker } from "@faultpact/worker/reporter";
import { runReporterEvidenceSubmission, REPORTER_PRECONDITION_CODES } from "@faultpact/worker/submit";
import { formatReporterSummary } from "@faultpact/worker/summary";

/**
 * LIVE GenLayer Studio Dev certification for the signer-backed evidence worker.
 *
 * This test writes real transactions to the frozen FaultPact deployment, so it
 * only runs when REPORTER_LIVE_TEST=1 is deliberately set together with a
 * funded, contract-authorized REPORTER_PRIVATE_KEY. Without that opt-in the run
 * reports NOT CONFIGURED; it never turns a missing credential into a pass.
 *
 *   REPORTER_LIVE_TEST=1 \
 *   REPORTER_PRIVATE_KEY=0x... \
 *   FAULTPACT_LIVE_TEST_INCIDENT_ID=12 \
 *   DATABASE_URL=... pnpm test:reporter-live
 */

const liveEnabled = /^(1|true|yes)$/i.test(String(process.env.REPORTER_LIVE_TEST ?? "").trim());
const privateKey = String(process.env.REPORTER_PRIVATE_KEY ?? "").trim();
const prepareIncident = /^(1|true|yes)$/i.test(String(process.env.FAULTPACT_LIVE_TEST_PREPARE_INCIDENT ?? "").trim());

if (!liveEnabled) {
  process.stdout.write("FAULTPACT REPORTER LIVE PROOF: NOT CONFIGURED\n");
  process.stdout.write("Set REPORTER_LIVE_TEST=1 with a funded, contract-authorized REPORTER_PRIVATE_KEY and FAULTPACT_LIVE_TEST_INCIDENT_ID to run the live Studio proof. No Studio state was changed.\n");
}

describe.skipIf(!liveEnabled)("LIVE Studio Dev signer-backed evidence proof", () => {
  let runtime: Awaited<ReturnType<typeof createReporterRuntime>> | undefined;
  let db: ReturnType<typeof createDb> | undefined;
  const result = { reporter: "", authorized: false, incidentId: "", artifactUrl: "", sha256: "", attachTx: "", submitTx: "", evidenceIds: [] as string[] };

  beforeAll(async () => {
    if (!REPORTER_KEY_PATTERN.test(privateKey)) {
      process.stdout.write("MISSING_REPORTER_PRIVATE_KEY: REPORTER_LIVE_TEST is enabled but REPORTER_PRIVATE_KEY is not a 32-byte hex key.\n");
      throw new ReporterConfigurationError("MISSING_REPORTER_PRIVATE_KEY", "REPORTER_LIVE_TEST=1 requires a funded, contract-authorized REPORTER_PRIVATE_KEY");
    }
    const env = loadEnv();
    db = createDb(env.DATABASE_URL);
    runtime = await createReporterRuntime({ env, db, verifyContractSource: true, trackOptions: { maxWaitMs: env.REPORTER_MAX_FINALIZATION_WAIT_MS } });
    result.reporter = runtime.deps.writer.address;
  }, 300_000);

  afterAll(async () => {
    await runtime?.close();
    await db?.$disconnect();
  });

  it("REPORTS_PRECONDITION_FAILURES_PRECISELY", async () => {
    const env = loadEnv();
    const chainId = await runtime!.adapter.chainIdFromRpc({ request: { subsystem: "reporter_live" } });
    expect(chainId, "WRONG_CHAIN").toBe(FROZEN_CHAIN_ID);
    const verification = await runtime!.adapter.verifyDeployment(undefined, { checkSchema: false });
    expect(verification.chainId).toBe(FROZEN_CHAIN_ID);
    expect(verification.sourceSha256, "WRONG_CONTRACT").toBe(FROZEN_SOURCE_SHA256);
    expect(verification.sourceMatches, "WRONG_CONTRACT").toBe(true);
    expect(verification.address.toLowerCase()).toBe(FROZEN_CONTRACT_ADDRESS.toLowerCase());
    expect(FROZEN_RPC_URL).toBe("https://studio-dev.genlayer.com/api");
    const authorized = await runtime!.adapter.isAuthorizedReporter(result.reporter, { subsystem: "reporter_live" });
    result.authorized = authorized;
    if (!authorized) {
      process.stdout.write(`REPORTER_NOT_AUTHORIZED: ${result.reporter} must be authorized through the frozen contract's authorize_reporter path before it can submit evidence.\n`);
    }
    expect(authorized, "REPORTER_NOT_AUTHORIZED").toBe(true);
    expect((EVIDENCE_TYPES as readonly string[]).includes(env.REPORTER_SUBMIT_EVIDENCE_TYPE), `unsupported REPORTER_SUBMIT_EVIDENCE_TYPE ${env.REPORTER_SUBMIT_EVIDENCE_TYPE}`).toBe(true);
  }, 300_000);

  it("SUBMITS_ARTIFACT_ATTACH_AND_SUBMIT_EVIDENCE_THROUGH_CONTRACT_STATE", async () => {
    const env = loadEnv();
    let incidentId = env.FAULTPACT_LIVE_TEST_INCIDENT_ID ? BigInt(env.FAULTPACT_LIVE_TEST_INCIDENT_ID) : undefined;
    if (!incidentId) {
      process.stdout.write("MISSING_LIVE_INCIDENT_ID: set FAULTPACT_LIVE_TEST_INCIDENT_ID or FAULTPACT_LIVE_TEST_PREPARE_INCIDENT=1\n");
      throw new ReporterConfigurationError(REPORTER_PRECONDITION_CODES.missingIncident, "MISSING_LIVE_INCIDENT_ID");
    }
    if (prepareIncident) incidentId = await openFixtureIncident(runtime!, incidentId);
    result.incidentId = incidentId.toString();
    runtime!.deps.options = {
      incidentId,
      summary: "faultpact phase 4.4 reporter certification",
      description: "faultpact phase 4.4 reporter certification",
      submitEvidenceType: (env.REPORTER_SUBMIT_EVIDENCE_TYPE ?? "THIRD_PARTY_MONITOR") as EvidenceType,
    };
    const outcome = await runReporterEvidenceSubmission(runtime!.deps);
    process.stdout.write(`${formatReporterSummary(outcome, { incidentId: incidentId.toString() }).join("\n")}\n`);
    result.artifactUrl = outcome.artifact.url;
    result.sha256 = outcome.artifact.sha256;
    result.attachTx = outcome.steps.find((step) => step.method === "attach_incident_report")?.txHash ?? "";
    result.submitTx = outcome.steps.find((step) => step.method === "submit_evidence")?.txHash ?? "";
    result.evidenceIds = outcome.evidenceIds;

    expect(outcome.failures, JSON.stringify(outcome.failures)).toEqual([]);
    expect(outcome.status).toBe("PASS");
    expect(outcome.reporterAuthorized).toBe(true);
    expect(outcome.artifact.httpVerification?.matched).toBe(true);
    expect(outcome.artifact.httpVerification?.httpSha256).toBe(outcome.artifact.sha256);
    for (const step of outcome.steps) {
      expect(step.finalization, `${step.method} finalization`).toBe("FINALIZED");
      expect(step.readBack?.passed, `${step.method} read-back`).toBe(true);
      expect(step.readBack?.record.uri).toBe(outcome.artifact.url);
      expect(step.readBack?.record.contentHash.toLowerCase().replace(/^0x/, "")).toBe(outcome.artifact.sha256);
      expect(step.readBack?.record.submitter.toLowerCase()).toBe(result.reporter.toLowerCase());
      expect(step.readBack?.record.reporterAuthorizedAtSubmission).toBe(true);
      expect(step.readBack?.record.provenance).toBe("AUTHORITATIVE");
    }
    process.stdout.write(`FAULTPACT REPORTER LIVE PROOF: PASS reporter=${result.reporter} incident=${result.incidentId} artifact=${result.artifactUrl} sha256=${result.sha256} attachTx=${result.attachTx} submitTx=${result.submitTx} evidenceIds=${result.evidenceIds.join(",")}\n`);
  }, 900_000);
});

/**
 * Optional fixture preparation using existing contract functionality only: the
 * frozen `open_incident` is called by the configured reporter so the live proof
 * always has an OPEN incident with a live evidence window. No governance state
 * is mutated.
 */
async function openFixtureIncident(runtime: NonNullable<Awaited<ReturnType<typeof createReporterRuntime>>>, configuredIncidentId: bigint): Promise<bigint> {
  const config = await runtime.adapter.getProtocolConfig({ subsystem: "reporter_live" }) as Record<string, unknown>;
  const bond = BigInt(String(config.report_bond ?? "0"));
  const serviceId = await fixtureServiceId(runtime, configuredIncidentId);
  const now = Math.floor(Date.now() / 1000);
  const before = await runtime.adapter.getCounters({ subsystem: "reporter_live" });
  // No opener evidence is attached, so the fixture does not consume an evidence slot.
  const args = buildOpenIncidentArgs({ serviceId, observedStart: now - 600, observedEnd: now - 300, summary: "faultpact phase 4.4 reporter fixture" });
  const sent = await runtime.deps.writer.send({ method: "open_incident", args, value: bond });
  const tracker = createReporterTracker(runtime.adapter.transport, { maxWaitMs: 600_000, initialPollMs: 2_000, maxPollMs: 8_000 });
  const outcome = await tracker.waitForFinalization(sent.txHash);
  if (outcome.finalization !== "FINALIZED") throw new Error(`open_incident did not finalize: ${outcome.finalization} ${outcome.reason ?? ""}`);
  const after = await runtime.adapter.getCounters({ subsystem: "reporter_live" });
  const nextId = BigInt(String(after.next_incident_id));
  if (nextId <= BigInt(String(before.next_incident_id))) throw new Error("open_incident did not create a new incident");
  const incidentId = nextId - 1n;
  process.stdout.write(`OPENED FIXTURE INCIDENT ${incidentId} (tx ${sent.txHash}) for service ${serviceId}\n`);
  return incidentId;
}

async function fixtureServiceId(runtime: NonNullable<Awaited<ReturnType<typeof createReporterRuntime>>>, configuredIncidentId: bigint): Promise<bigint> {
  const incident = await runtime.adapter.getIncident(configuredIncidentId, { subsystem: "reporter_live" }).catch(() => undefined);
  if (incident && incident.service_id !== undefined) return BigInt(String(incident.service_id));
  const counters = await runtime.adapter.getCounters({ subsystem: "reporter_live" });
  return BigInt(String(counters.next_service_id)) - 1n;
}
