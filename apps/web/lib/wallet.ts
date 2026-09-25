"use client";

import { buildLegacyTransactionData } from "@faultpact/contract/legacy";
import { getMethodDefinition } from "@faultpact/contract/schema";
import { encodeFunctionData } from "viem";

export const FAULTPACT_CHAIN_ID = 61997;
export const FAULTPACT_CHAIN_HEX = "0x" + FAULTPACT_CHAIN_ID.toString(16);
const FAULTPACT_RPC_URL = "https://studio-dev.genlayer.com/api";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

export type GenLayerTransactionState = {
  hash: string;
  status: string;
  result?: string;
  raw: Record<string, unknown>;
};

export type StudioFeePreset = {
  feeValue: bigint;
  distribution: {
    leaderTimeunitsAllocation: bigint;
    validatorTimeunitsAllocation: bigint;
    appealRounds: bigint;
    executionBudgetPerRound: bigint;
    executionConsumed: bigint;
    totalMessageFees: bigint;
    rotations: bigint[];
    maxPriceGenPerTimeUnit: bigint;
    storageFeeMaxGasPrice: bigint;
    receiptFeeMaxGasPrice: bigint;
  };
};

const CONSENSUS_MAIN_CONTRACT = "0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575";
const INITIAL_VALIDATORS = 5n;
const MAX_ROTATIONS = 3n;
const FALLBACK_GAS = 8_000_000n;
const EXECUTION_BUDGET_HEADROOM_BPS = 20_000n;

const FEE_DISTRIBUTION_COMPONENTS = [
  { name: "leaderTimeunitsAllocation", type: "uint256" },
  { name: "validatorTimeunitsAllocation", type: "uint256" },
  { name: "appealRounds", type: "uint256" },
  { name: "executionBudgetPerRound", type: "uint256" },
  { name: "executionConsumed", type: "uint256" },
  { name: "totalMessageFees", type: "uint256" },
  { name: "rotations", type: "uint256[]" },
  { name: "maxPriceGenPerTimeUnit", type: "uint256" },
  { name: "storageFeeMaxGasPrice", type: "uint256" },
  { name: "receiptFeeMaxGasPrice", type: "uint256" },
] as const;

const MESSAGE_FEE_ALLOCATION_COMPONENTS = [
  { name: "messageType", type: "uint8" },
  { name: "onAcceptance", type: "bool" },
  { name: "parentIndex", type: "uint256" },
  { name: "recipient", type: "address" },
  { name: "callKey", type: "bytes32" },
  { name: "budget", type: "uint256" },
  { name: "feeParams", type: "bytes" },
] as const;

const ADD_TRANSACTION_WITH_FEES_ABI = [{
  type: "function",
  name: "addTransaction",
  stateMutability: "payable",
  inputs: [{
    name: "_params",
    type: "tuple",
    components: [
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "numOfInitialValidators", type: "uint256" },
      { name: "maxRotations", type: "uint256" },
      { name: "validUntil", type: "uint256" },
      { name: "saltNonce", type: "uint256" },
      { name: "userValue", type: "uint256" },
      { name: "feesDistribution", type: "tuple", components: FEE_DISTRIBUTION_COMPONENTS },
      { name: "txCalldata", type: "bytes" },
      { name: "messageAllocations", type: "tuple[]", components: MESSAGE_FEE_ALLOCATION_COMPONENTS },
    ],
  }],
  outputs: [],
}] as const;

declare global {
  interface Window { ethereum?: Eip1193Provider; }
}

export function provider(): Eip1193Provider | undefined {
  return typeof window !== "undefined" ? window.ethereum : undefined;
}

export async function walletAccounts(): Promise<string[]> {
  const injected = provider();
  if (!injected) return [];
  const result = await injected.request({ method: "eth_accounts" });
  return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : [];
}

export async function walletChainId(): Promise<number | null> {
  const injected = provider();
  if (!injected) return null;
  const value = await injected.request({ method: "eth_chainId" });
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function connectWallet(): Promise<{ address: string; chainId: number | null }> {
  const injected = provider();
  if (!injected) throw new Error("No compatible wallet detected. Install a wallet that supports EIP-1193.");
  const result = await injected.request({ method: "eth_requestAccounts" });
  const accounts = Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : [];
  if (!accounts[0]) throw new Error("The wallet returned no account.");
  return { address: accounts[0], chainId: await walletChainId() };
}

export async function walletBalance(address: string): Promise<bigint> {
  const injected = provider();
  if (!injected) throw new Error("No compatible wallet detected.");
  const balance = await injected.request({ method: "eth_getBalance", params: [address, "latest"] });
  if (typeof balance !== "string" || !/^0x[0-9a-f]+$/i.test(balance)) throw new Error("Wallet returned an invalid balance.");
  return BigInt(balance);
}

export async function switchToFaultPact(): Promise<void> {
  const injected = provider();
  if (!injected) throw new Error("No compatible wallet detected.");
  try {
    await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FAULTPACT_CHAIN_HEX }] });
  } catch (error: unknown) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    const message = error instanceof Error ? error.message : error && typeof error === "object" ? String((error as { message?: unknown }).message ?? "") : String(error);
    if (Number(code) !== 4902 && !/unrecognized chain id|unknown chain/i.test(message)) throw error;
    await injected.request({ method: "wallet_addEthereumChain", params: [{ chainId: FAULTPACT_CHAIN_HEX, chainName: "GenLayer Studio Development Preview", nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: [FAULTPACT_RPC_URL] }] });
    await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FAULTPACT_CHAIN_HEX }] });
  }
}

function feeAmount(value: unknown, field: string): bigint {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Error(`Studio fee settings contain an invalid ${field}.`);
}

export async function getStudioFeePreset(): Promise<StudioFeePreset> {
  const response = await fetch(FAULTPACT_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sim_getFeeConfig", params: [] }),
    signal: AbortSignal.timeout(10_000),
  });
  let payload: { result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
  try { payload = await response.json() as typeof payload; }
  catch { throw new Error(`Studio fee settings returned HTTP ${response.status} with an invalid response.`); }
  const error = payload.error;
  const errorData = error?.data && typeof error.data === "object" ? error.data as Record<string, unknown> : undefined;
  const message = typeof error?.message === "string" ? error.message : `HTTP ${response.status}`;
  if (!response.ok || error) {
    if (response.status === 429 || Number(error?.code) === -32029 || /rate limit/i.test(message)) {
      const delay = retryAfter(response, errorData);
      throw new Error(`Studio is temporarily rate limiting fee settings${delay === undefined ? ". Try again shortly." : `; retry after ${Math.ceil(delay / 1000)} seconds.`} No transaction was sent.`);
    }
    throw new Error(`Studio fee settings are unavailable: ${message}`);
  }
  const result = payload.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : undefined;
  const preset = result?.defaultFees && typeof result.defaultFees === "object" ? result.defaultFees as Record<string, unknown> : undefined;
  const raw = preset?.distribution && typeof preset.distribution === "object" ? preset.distribution as Record<string, unknown> : undefined;
  if (result?.enabled !== true || !preset || !raw || !Array.isArray(raw.rotations)) throw new Error("Studio has not published the fee settings required for this transaction.");
  const baseExecutionBudget = feeAmount(raw.executionBudgetPerRound, "execution budget");
  const executionBudgetPerRound = (baseExecutionBudget * EXECUTION_BUDGET_HEADROOM_BPS + 9_999n) / 10_000n;
  const rotations = raw.rotations.map((value) => feeAmount(value, "rotations"));
  const appealRounds = feeAmount(raw.appealRounds, "appeal rounds");
  const feeValue = feeAmount(preset.feeValue, "deposit") + (executionBudgetPerRound - baseExecutionBudget) * rotations.reduce((rounds, count) => rounds + count + 1n, appealRounds);
  return {
    feeValue,
    distribution: {
      leaderTimeunitsAllocation: feeAmount(raw.leaderTimeunitsAllocation, "leader allocation"),
      validatorTimeunitsAllocation: feeAmount(raw.validatorTimeunitsAllocation, "validator allocation"),
      appealRounds,
      executionBudgetPerRound,
      executionConsumed: feeAmount(raw.executionConsumed, "execution use"),
      totalMessageFees: feeAmount(raw.totalMessageFees, "message fees"),
      rotations,
      maxPriceGenPerTimeUnit: feeAmount(raw.maxPriceGenPerTimeUnit, "GEN price cap"),
      storageFeeMaxGasPrice: feeAmount(raw.storageFeeMaxGasPrice, "storage price cap"),
      receiptFeeMaxGasPrice: feeAmount(raw.receiptFeeMaxGasPrice, "receipt price cap"),
    },
  };
}

export function buildConsensusCallData(sender: string, method: string, args: readonly unknown[], feePreset: StudioFeePreset, userValue = 0n): string {
  validateWrite(method, args, userValue, true);
  if (!/^0x[a-fA-F0-9]{40}$/.test(sender)) throw new Error("Wallet returned an invalid address.");
  if (feePreset.feeValue <= 0n) throw new Error("Studio fee deposit must be greater than zero.");
  const txCalldata = buildLegacyTransactionData(method, args);
  return encodeFunctionData({
    abi: ADD_TRANSACTION_WITH_FEES_ABI,
    functionName: "addTransaction",
    args: [{
      sender: sender as `0x${string}`,
      recipient: "0xeb858957e3C426597245f6b59E260f1cC556Bf13",
      numOfInitialValidators: INITIAL_VALIDATORS,
      maxRotations: MAX_ROTATIONS,
      validUntil: BigInt(Math.floor(Date.now() / 1000) + 3600),
      saltNonce: 0n,
      userValue,
      feesDistribution: feePreset.distribution,
      txCalldata: txCalldata as `0x${string}`,
      messageAllocations: [],
    }],
  });
}

function validateWrite(method: string, args: readonly unknown[], value: bigint, includeValue: boolean): void {
  const definition = getMethodDefinition(method);
  if (!definition) throw new Error("This action is not supported by the frozen contract schema.");
  if (definition.readonly) throw new Error("This contract action only reads state and cannot be submitted as a transaction.");
  if (definition.params.length !== args.length) throw new Error("This action is missing required information.");
  for (const [index, [, type]] of definition.params.entries()) {
    const arg = args[index];
    if (type === "int" && (typeof arg !== "bigint" || arg < 0n)) throw new Error("Financial and protocol amounts must use unsigned integer precision.");
    if (type === "string" && typeof arg !== "string") throw new Error("A text field is invalid.");
    if (type === "address" && (typeof arg !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(arg))) throw new Error("A wallet address is invalid.");
  }
  if (includeValue && Boolean(definition.payable) !== (value > 0n)) throw new Error("Wallet payment does not match the frozen contract action.");
}

async function estimateGas(injected: Eip1193Provider, request: { from: string; to: string; data: string; value: string }): Promise<string> {
  try {
    const estimate = await injected.request({ method: "eth_estimateGas", params: [request] });
    if (typeof estimate === "string" && /^0x[0-9a-f]+$/i.test(estimate)) return estimate;
  } catch {
    // The pinned SDK uses a bounded fixed fallback when Studio cannot estimate.
  }
  return `0x${FALLBACK_GAS.toString(16)}`;
}

export async function sendFaultPactTransaction(method: string, args: readonly unknown[], value: bigint, expectedAddress: string | undefined, feePreset: StudioFeePreset): Promise<string> {
  const injected = provider();
  if (!injected) throw new Error("No compatible wallet detected.");
  const accounts = await walletAccounts();
  const sender = accounts[0];
  if (!sender) throw new Error("Connect a wallet before signing.");
  if (expectedAddress && sender.toLowerCase() !== expectedAddress.toLowerCase()) throw new Error("The connected account changed. Review this action again with the current wallet.");
  const chainId = await walletChainId();
  if (chainId !== FAULTPACT_CHAIN_ID) throw new Error(`Switch the wallet to Chain ${FAULTPACT_CHAIN_ID} before signing.`);
  if (value < 0n) throw new Error("Transaction value cannot be negative.");
  validateWrite(method, args, value, true);
  const data = buildConsensusCallData(sender, method, args, feePreset, value);
  const valueHex = `0x${(value + feePreset.feeValue).toString(16)}`;
  const tx = { from: sender, to: CONSENSUS_MAIN_CONTRACT, data, value: valueHex };
  const gasPrice = await injected.request({ method: "eth_gasPrice" }).catch(() => undefined);
  const gasPriceField = typeof gasPrice === "string" && /^0x[0-9a-f]+$/i.test(gasPrice) ? { gasPrice } : {};
  const hash = await injected.request({ method: "eth_sendTransaction", params: [{ ...tx, ...gasPriceField, type: "0x0", chainId: FAULTPACT_CHAIN_HEX, gas: await estimateGas(injected, tx) }] });
  if (typeof hash !== "string" || !hash) throw new Error("Wallet did not return a transaction hash.");
  return hash;
}

export function walletErrorMessage(error: unknown): string {
  const raw = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const data = raw?.data && typeof raw.data === "object" ? raw.data as Record<string, unknown> : undefined;
  const source = error instanceof Error ? error.message : typeof error === "string" ? error : [raw?.shortMessage, raw?.message, raw?.reason, data?.message].filter((value): value is string => typeof value === "string").join(" ") || String(error);
  const code = Number(raw?.code);
  if (code === 4001 || /user rejected|user denied|request rejected/i.test(source)) return "You declined the wallet request. No transaction was submitted.";
  if (code === 4902 || /unrecognized chain id|unknown chain|wrong network|switch.*chain 61997/i.test(source)) return "Switch your wallet to GenLayer Studio Development Preview (Chain 61997) and review again.";
  const known: Array<[RegExp, string]> = [
    [/ERR_INSUFFICIENT_FREE_CAPITAL|ERR_ALLOCATED_RESERVED|ERR_CAPACITY/i, "This Pact does not have enough free capital for that action."],
    [/ERR_INSUFFICIENT_BALANCE|insufficient funds|insufficient balance/i, "The wallet does not have enough GEN for this transaction."],
    [/ERR_NOT_PROVIDER_OWNER|wrong provider owner|provider owner/i, "The connected wallet does not own this Provider."],
    [/ERR_CLAIM_WINDOW|claim deadline|claim window/i, "The claim deadline has passed."],
    [/ERR_SERVICE_MISMATCH|ERR_NO_OVERLAP|incident not eligible/i, "This Incident does not match the Coverage service and period."],
    [/ERR_DUPLICATE_CLAIM/i, "A Claim has already been filed for this Coverage and Incident."],
    [/ERR_SALES_PAUSED|ERR_PACT_NOT_ACTIVE|ERR_NOT_SELLABLE|ERR_SERVICE_RETIRED/i, "This Pact is not currently available for new Coverage."],
    [/ERR_COOLDOWN/i, "The withdrawal cooldown has not finished yet."],
    [/ERR_NO_PENDING_WITHDRAWAL/i, "There is no pending withdrawal to execute or cancel."],
    [/ERR_INSUFFICIENT_CREDIT/i, "The requested amount exceeds your claimable FaultPact credit."],
    [/No compatible wallet detected/i, "Install or unlock Rabby or MetaMask, then connect your wallet."],
    [/FaultPact action failed/i, "GenLayer finalized the transaction, but the FaultPact action failed. No contract state changed."],
    [/execution result could not be verified/i, "GenLayer finalized the transaction, but FaultPact could not confirm whether the action succeeded. Keep the hash and do not resubmit until the result is checked."],
    [/timed out waiting/i, "The network has not finalized this transaction yet. Keep the transaction hash and do not resubmit."],
    [/FeesDistributionMissing/i, "Studio rejected this transaction because its GEN fee distribution was missing. No FaultPact state changed; refresh the fee estimate and try again."],
    [/rate limiting fee settings|fee settings are unavailable/i, "GenLayer cannot provide the fee estimate right now. No transaction was sent; retry after Studio is available."],
  ];
  return known.find(([pattern]) => pattern.test(source))?.[1] ?? "The wallet or network could not complete this action. Review the transaction details and try again.";
}

export function walletErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return String(error);
  const value = error as Record<string, unknown>;
  const data = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : undefined;
  return [
    ["code", value.code],
    ["message", value.shortMessage ?? value.message],
    ["reason", value.reason],
    ["data", data?.message],
  ].filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number")
    .map(([key, detail]) => `${key}: ${detail}`).join("\n") || Object.keys(value).join(", ") || "Unspecified wallet error";
}

function transactionStatus(raw: Record<string, unknown>): string {
  return typeof raw.status === "string" ? raw.status.replace(/\s+/g, "_").toUpperCase() : "PENDING";
}

type StatusRpcError = Error & { code?: number; retryAfterMs?: number };

function retryAfter(response: Response, data?: Record<string, unknown>): number | undefined {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const seconds = Number(data?.retry_after_seconds);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

async function studioStatusRpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(FAULTPACT_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  let payload: { result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
  try { payload = await response.json() as typeof payload; }
  catch { throw new Error(`Studio ${method} returned HTTP ${response.status} with an invalid response.`); }
  const error = payload.error;
  const data = error?.data && typeof error.data === "object" ? error.data as Record<string, unknown> : undefined;
  const message = typeof error?.message === "string" ? error.message : `HTTP ${response.status}`;
  const rateLimited = response.status === 429 || Number(error?.code) === -32029 || /rate limit/i.test(message);
  if (!response.ok || error) {
    if (rateLimited) {
      const cause = new Error("Studio is rate limiting transaction status checks.") as StatusRpcError;
      cause.retryAfterMs = retryAfter(response, data);
      throw cause;
    }
    const cause = new Error(`Studio ${method} failed: ${message}`) as StatusRpcError;
    cause.code = Number(error?.code);
    throw cause;
  }
  return payload.result;
}

async function getGenLayerTransactionStatus(hash: string): Promise<GenLayerTransactionState> {
  let resultValue: unknown;
  try { resultValue = await studioStatusRpc("gen_getTransactionStatus", [{ txId: hash }]); }
  catch (error: unknown) {
    if (error && typeof error === "object" && Number((error as StatusRpcError).code) === -32001 && /transaction .* not found/i.test(error instanceof Error ? error.message : "")) {
      return { hash, status: "PENDING", raw: { transactionNotFound: true } };
    }
    throw error;
  }
  const result = resultValue && typeof resultValue === "object" ? resultValue as Record<string, unknown> : undefined;
  if (!result || typeof result.status !== "string") throw new Error("GenLayer status response did not include a transaction status.");
  const rawStatus = result.status;
  return { hash, status: transactionStatus({ status: rawStatus }), raw: result };
}

async function getEvmTransactionReceipt(hash: string): Promise<Record<string, unknown> | undefined> {
  try {
    const result = await studioStatusRpc("eth_getTransactionReceipt", [hash]);
    return result && typeof result === "object" ? result as Record<string, unknown> : undefined;
  } catch (error: unknown) {
    if (error && typeof error === "object" && Number((error as StatusRpcError).code) === -32001 && /not found/i.test(error instanceof Error ? error.message : "")) return undefined;
    throw error;
  }
}

async function getFinalizedExecutionResult(hash: string): Promise<string> {
  const value = await studioStatusRpc("eth_getTransactionByHash", [hash]);
  const transaction = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  const named = typeof transaction?.txExecutionResultName === "string" ? transaction.txExecutionResultName.toUpperCase() : undefined;
  const executionResult = named ?? ({ "0": "NOT_VOTED", "1": "FINISHED_WITH_RETURN", "2": "FINISHED_WITH_ERROR" } as Record<string, string>)[String(transaction?.txExecutionResult)];
  if (executionResult === "FINISHED_WITH_ERROR") throw new Error("GenLayer finalized this transaction, but the FaultPact action failed. No contract state changed.");
  if (executionResult !== "FINISHED_WITH_RETURN") throw new Error("GenLayer finalized this transaction, but its contract execution result could not be verified. Do not resubmit until the transaction is checked.");
  return executionResult;
}

export async function waitForGenLayerFinalization(hash: string, onUpdate?: (state: GenLayerTransactionState) => void, options: { intervalMs?: number; attempts?: number } = {}): Promise<GenLayerTransactionState> {
  const intervalMs = options.intervalMs ?? 3_000;
  const attempts = options.attempts ?? 120;
  let receiptChecked = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let retryDelay = Math.min(60_000, intervalMs * 2 ** Math.min(attempt, 5));
    try {
      const state = await getGenLayerTransactionStatus(hash);
      if (state.raw.transactionNotFound && !receiptChecked) {
        receiptChecked = true;
        const receipt = await getEvmTransactionReceipt(hash);
        if (["0x0", "0", 0].includes(receipt?.status as string | number)) {
          throw new Error(`Consensus submission reverted before GenLayer accepted it: ${String(receipt?.revertReason ?? "EVM execution failed")}`);
        }
      }
      if (state.status === "FINALIZED") {
        const result = await getFinalizedExecutionResult(hash);
        const completed = { ...state, result };
        onUpdate?.(completed);
        return completed;
      }
      onUpdate?.(state);
      if (["REVERTED", "FAILED", "REJECTED", "CANCELLED", "CANCELED"].includes(state.status)) throw new Error(`GenLayer transaction ${state.status.toLowerCase()}`);
    } catch (error: unknown) {
      if (!error || typeof error !== "object" || !("retryAfterMs" in error)) throw error;
      const rateLimited = error as StatusRpcError;
      retryDelay = Math.max(retryDelay, rateLimited.retryAfterMs ?? 0);
      onUpdate?.({ hash, status: "RPC_DEGRADED", raw: { message: rateLimited.message, retryAfterMs: rateLimited.retryAfterMs } });
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay + Math.floor(Math.random() * 250)));
  }
  throw new Error("Timed out waiting for GenLayer finalization; keep the transaction hash and check its status again.");
}
