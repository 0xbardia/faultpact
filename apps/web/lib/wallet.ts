"use client";

import { buildLegacyTransactionData } from "@faultpact/contract/legacy";

export const FAULTPACT_CHAIN_ID = 61997;
export const FAULTPACT_CHAIN_HEX = "0x" + FAULTPACT_CHAIN_ID.toString(16);

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

const CONSENSUS_MAIN_CONTRACT = "0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575";
const ADD_TRANSACTION_SELECTOR = "27241a99";
const INITIAL_VALIDATORS = 5n;
const MAX_ROTATIONS = 3n;
const FALLBACK_GAS = 8_000_000n;

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

export async function switchToFaultPact(): Promise<void> {
  const injected = provider();
  if (!injected) throw new Error("No compatible wallet detected.");
  try {
    await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FAULTPACT_CHAIN_HEX }] });
  } catch (error: unknown) {
    const code = error && typeof error === "object" ? (error as { code?: number }).code : undefined;
    if (code !== 4902) throw error;
    await injected.request({ method: "wallet_addEthereumChain", params: [{ chainId: FAULTPACT_CHAIN_HEX, chainName: "GenLayer Studio Development Preview", nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: ["https://studio-dev.genlayer.com/api"] }] });
  }
}

function hexByte(value: number): string { return value.toString(16).padStart(2, "0"); }

function hexToBytes(value: string): Uint8Array {
  const hex = value.replace(/^0x/, "");
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error("Invalid transaction data");
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function word(value: bigint): string {
  if (value < 0n) throw new Error("ABI values must be unsigned");
  return value.toString(16).padStart(64, "0");
}

function addressWord(address: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("Wallet returned an invalid address");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeAddTransaction(sender: string, txData: Uint8Array): string {
  const dataHex = Array.from(txData, hexByte).join("");
  const paddedData = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, "0");
  const head = [addressWord(sender), addressWord("0xeb858957e3C426597245f6b59E260f1cC556Bf13"), word(INITIAL_VALIDATORS), word(MAX_ROTATIONS), word(160n)];
  return `0x${ADD_TRANSACTION_SELECTOR}${head.join("")}${word(BigInt(txData.byteLength))}${paddedData}`;
}

export function buildConsensusCallData(sender: string, method: string, args: readonly unknown[]): string {
  return encodeAddTransaction(sender, hexToBytes(buildLegacyTransactionData(method, args)));
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

export async function sendFaultPactTransaction(method: string, args: readonly unknown[], value = 0n): Promise<string> {
  const injected = provider();
  if (!injected) throw new Error("No compatible wallet detected.");
  const accounts = await walletAccounts();
  const sender = accounts[0];
  if (!sender) throw new Error("Connect a wallet before signing.");
  const chainId = await walletChainId();
  if (chainId !== FAULTPACT_CHAIN_ID) throw new Error(`Switch the wallet to Chain ${FAULTPACT_CHAIN_ID} before signing.`);
  if (value < 0n) throw new Error("Transaction value cannot be negative.");
  const data = buildConsensusCallData(sender, method, args);
  const valueHex = `0x${value.toString(16)}`;
  const tx = { from: sender, to: CONSENSUS_MAIN_CONTRACT, data, value: valueHex };
  return await injected.request({ method: "eth_sendTransaction", params: [{ ...tx, gas: await estimateGas(injected, tx) }] }) as string;
}

function transactionStatus(raw: Record<string, unknown>): string {
  return typeof raw.status === "string" ? raw.status.toUpperCase() : "PENDING";
}

export async function waitForGenLayerFinalization(hash: string, onUpdate?: (state: GenLayerTransactionState) => void, options: { intervalMs?: number; attempts?: number } = {}): Promise<GenLayerTransactionState> {
  const injected = provider();
  if (!injected) throw new Error("No compatible wallet detected.");
  const intervalMs = options.intervalMs ?? 3_000;
  const attempts = options.attempts ?? 120;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await injected.request({ method: "eth_getTransactionByHash", params: [hash] });
    if (result && typeof result === "object") {
      const raw = result as Record<string, unknown>;
      const state: GenLayerTransactionState = { hash, status: transactionStatus(raw), ...(typeof raw.result_name === "string" ? { result: raw.result_name } : {}), raw };
      onUpdate?.(state);
      if (["FINALIZED", "ACCEPTED"].includes(state.status)) return state;
      if (["REVERTED", "FAILED", "REJECTED", "CANCELLED", "CANCELED"].includes(state.status)) throw new Error(`GenLayer transaction ${state.status.toLowerCase()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for GenLayer finalization; keep the transaction hash and check its status again.");
}
