/**
 * GenLayer transaction lifecycle tracking for signer-backed reporter writes.
 *
 * Submission is never treated as success. Every reporter transaction is
 * observed through the shared Studio transport until it reaches a decided
 * state, and a bounded wait that expires is reported as NOT VERIFIED rather
 * than as a pass.
 */

export type ReporterTxState = "SUBMITTED" | "PENDING" | "FINALIZING" | "FINALIZED" | "FAILED" | "NOT_FOUND";

export type TransactionObservation = {
  hash: string;
  state: ReporterTxState;
  rawStatus?: string;
  executionResult?: string;
  consensusResult?: string;
  sender?: string;
  recipient?: string;
  blockReference?: string;
  createdAt?: string;
  finalizedAt?: string;
  appealed: boolean;
  observedAt: string;
};

export type FinalizationOutcome = {
  hash: string;
  finalization: "FINALIZED" | "FAILED" | "NOT_VERIFIED";
  state: ReporterTxState;
  polls: number;
  elapsedMs: number;
  observation?: TransactionObservation;
  reason?: string;
};

const SUCCESSFUL_EXECUTION = "FINISHED_WITH_RETURN";
const TERMINAL_FAILURES = new Set(["REVERTED", "CANCELED", "CANCELLED", "NOT_VOTED", "GENESIS", "UNDETERMINED", "NO_MAJORITY"]);
const IN_FLIGHT = new Set(["UNINITIALIZED", "PENDING", "PROPOSING", "COMMITTING", "REVEALING", "ACCEPTED", "UNDECIDED", "APPEAL_REVEALING", "APPEAL_COMMITTING", "READY_TO_FINALIZE", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT", "AWAITING_APPEAL"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Maps a raw `eth_getTransactionByHash` consensus record onto the lifecycle the
 * reporter worker persists. Only a decided transaction with a successful
 * execution is FINALIZED; every other decided outcome is FAILED.
 */
export function mapTransactionRecord(raw: unknown, hash: string, observedAt: string): TransactionObservation {
  const record = asRecord(raw);
  if (!record) return { hash, state: "NOT_FOUND", appealed: false, observedAt };
  const rawStatus = asOptionalString(record.status)?.toUpperCase() ?? "UNKNOWN";
  const executionResult = asOptionalString(record.txExecutionResultName)?.toUpperCase();
  const consensusResult = asOptionalString(record.result_name) ?? asOptionalString(record.resultName);
  const sender = asOptionalString(record.from_address) ?? asOptionalString(record.origin_address);
  const recipient = asOptionalString(record.to_address);
  const blockReference = asOptionalString(record.block_hash) ?? asOptionalString(record.blockHash);
  const createdAt = asOptionalString(record.created_at) ?? asOptionalString(record.created_timestamp);
  const finalizedAt = asOptionalString(record.finalized_at);
  const appealed = record.appealed === true;
  const base = { hash, rawStatus, ...(executionResult ? { executionResult } : {}), ...(consensusResult ? { consensusResult } : {}), ...(sender ? { sender } : {}), ...(recipient ? { recipient } : {}), ...(blockReference ? { blockReference } : {}), ...(createdAt ? { createdAt } : {}), ...(finalizedAt ? { finalizedAt } : {}), appealed, observedAt };
  if (rawStatus === "FINALIZED") {
    return executionResult === SUCCESSFUL_EXECUTION
      ? { ...base, state: "FINALIZED" }
      : { ...base, state: "FAILED" };
  }
  if (TERMINAL_FAILURES.has(rawStatus)) return { ...base, state: "FAILED" };
  if (IN_FLIGHT.has(rawStatus)) {
    const finalizing = rawStatus !== "PENDING" && rawStatus !== "UNINITIALIZED" && rawStatus !== "UNDECIDED";
    return { ...base, state: finalizing ? "FINALIZING" : "PENDING" };
  }
  return { ...base, state: "PENDING" };
}

export function isDecided(observation: TransactionObservation): boolean {
  return observation.state === "FINALIZED" || observation.state === "FAILED";
}

export type TransactionTrackerOptions = {
  fetchTransaction: (hash: string) => Promise<TransactionObservation>;
  maxWaitMs?: number;
  initialPollMs?: number;
  maxPollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onPoll?: (observation: TransactionObservation) => void;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

const RATE_LIMIT_PATTERN = /\b429\b|cooldown|rate[\s-]?limit|daily budget|quota/i;

export class TransactionTracker {
  constructor(private readonly options: TransactionTrackerOptions) {}

  /**
   * Polls a submitted transaction until it is decided or the bounded wait
   * expires. Rate limits and temporary RPC failures extend the backoff instead
   * of forcing rapid re-polls; an exhausted budget is NOT VERIFIED, never PASS.
   */
  async waitForFinalization(hash: string): Promise<FinalizationOutcome> {
    const now = this.options.now ?? Date.now;
    const sleep = this.options.sleep ?? defaultSleep;
    const maxWaitMs = this.options.maxWaitMs ?? 180_000;
    const initialPollMs = this.options.initialPollMs ?? 1_000;
    const maxPollMs = this.options.maxPollMs ?? 8_000;
    const startedAt = now();
    let polls = 0;
    let delayMs = Math.max(100, initialPollMs);
    let lastState: ReporterTxState = "SUBMITTED";
    let lastReason: string | undefined;
    while (now() - startedAt <= maxWaitMs) {
      polls += 1;
      let observation: TransactionObservation;
      try {
        observation = await this.options.fetchTransaction(hash);
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
        if (!RATE_LIMIT_PATTERN.test(lastReason) && now() - startedAt > 30_000) {
          return { hash, finalization: "NOT_VERIFIED", state: lastState, polls, elapsedMs: now() - startedAt, reason: lastReason };
        }
        await sleep(delayMs);
        delayMs = Math.min(maxPollMs, Math.round(delayMs * 2));
        continue;
      }
      lastState = observation.state;
      this.options.onPoll?.(observation);
      if (isDecided(observation)) {
        return {
          hash,
          finalization: observation.state === "FINALIZED" ? "FINALIZED" : "FAILED",
          state: observation.state,
          polls,
          elapsedMs: now() - startedAt,
          observation,
          ...(observation.state === "FAILED" ? { reason: `${observation.rawStatus}${observation.executionResult ? `/${observation.executionResult}` : ""}` } : {}),
        };
      }
      await sleep(delayMs);
      delayMs = Math.min(maxPollMs, Math.round(delayMs * 1.5));
    }
    return { hash, finalization: "NOT_VERIFIED", state: lastState, polls, elapsedMs: now() - startedAt, ...(lastReason ? { reason: lastReason } : { reason: "finalization was not observed within the bounded wait" }) };
  }
}
