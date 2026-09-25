import { createAccount, createClient } from "genlayer-js";
import type { CalldataEncodable } from "genlayer-js/types";
import { studionet } from "genlayer-js/chains";
import { FROZEN_CHAIN_ID, FROZEN_RPC_URL } from "@faultpact/shared";
import { StudioRpcBridge } from "./bridge.js";
import type { RpcTransport } from "./rpc.js";

export const REPORTER_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export type ReporterWriteRequest = {
  method: string;
  args: readonly unknown[];
  value?: bigint;
};

export type ReporterWriteResult = {
  txHash: string;
  sender: string;
  recipient: string;
  submittedAt: string;
};

export type ReporterWriter = {
  readonly address: string;
  send(request: ReporterWriteRequest): Promise<ReporterWriteResult>;
  close(): Promise<void>;
};

export class ReporterConfigurationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReporterConfigurationError";
  }
}

/**
 * The reporter private key is never returned, logged or included in an error
 * message. Every thrown message passes through this redactor first.
 */
function redact(text: string, privateKey: string): string {
  return text.split(privateKey).join("<redacted>").split(privateKey.slice(2).toLowerCase()).join("<redacted>").split(privateKey.toLowerCase()).join("<redacted>");
}

export function assertReporterPrivateKeyFormat(value: string): `0x${string}` {
  if (!REPORTER_KEY_PATTERN.test(value)) throw new ReporterConfigurationError("MISSING_REPORTER_PRIVATE_KEY", "REPORTER_PRIVATE_KEY must be a 32-byte 0x-prefixed hex private key");
  return value as `0x${string}`;
}

/** Derives the public reporter address from the configured private key. */
export function deriveReporterAddress(privateKey: string): string {
  try {
    return createAccount(assertReporterPrivateKeyFormat(privateKey)).address;
  } catch (error) {
    if (error instanceof ReporterConfigurationError) throw error;
    throw new ReporterConfigurationError("MISSING_REPORTER_PRIVATE_KEY", "REPORTER_PRIVATE_KEY could not be loaded into a signer");
  }
}

function studioDevChain(chainId: number) {
  // The SDK ships a Studio chain definition whose consensus addresses and
  // addTransaction encoding this deployment uses. Only the chain identity and
  // endpoint are overridden so the signer can never target another network.
  return { ...studionet, id: chainId, name: "Genlayer Studio Development Preview" } as typeof studionet;
}

export type ReporterWriterOptions = {
  privateKey: string;
  contractAddress: string;
  transport: RpcTransport;
  chainId?: number;
  rpcUrl?: string;
  subsystem?: string;
  now?: () => Date;
};

/**
 * Creates a signer-backed contract writer.
 *
 * Signing, calldata encoding and consensus submission are performed by the
 * GenLayer SDK; every RPC call it makes is proxied through the shared Studio
 * transport so a reporter submission cannot create an unmanaged request storm.
 */
export async function createReporterWriter(options: ReporterWriterOptions): Promise<ReporterWriter> {
  const privateKey = assertReporterPrivateKeyFormat(options.privateKey);
  const account = createAccount(privateKey);
  const chainId = options.chainId ?? FROZEN_CHAIN_ID;
  const rpcUrl = options.rpcUrl ?? FROZEN_RPC_URL;
  if (chainId !== FROZEN_CHAIN_ID) throw new ReporterConfigurationError("WRONG_CHAIN", `Refusing to sign for chain ${chainId}; FaultPact is frozen on chain ${FROZEN_CHAIN_ID}`);
  if (rpcUrl !== FROZEN_RPC_URL) throw new ReporterConfigurationError("WRONG_CHAIN", `Refusing to sign against ${rpcUrl}; FaultPact is frozen on ${FROZEN_RPC_URL}`);
  const bridge = new StudioRpcBridge({ transport: options.transport, subsystem: options.subsystem ?? "reporter_write" });
  let client: ReturnType<typeof createClient> | undefined;
  try {
    const { url } = await bridge.start();
    client = createClient({ chain: studioDevChain(chainId), endpoint: url, account });
  } catch (error) {
    await bridge.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redact(`Reporter signer could not be initialised: ${message}`, privateKey));
  }
  const now = options.now ?? (() => new Date());
  return {
    address: account.address,
    async send(request) {
      if (!client) throw new Error("Reporter writer is closed");
      const write = {
        address: options.contractAddress as `0x${string}`,
        functionName: request.method,
        args: [...request.args] as CalldataEncodable[],
        value: request.value ?? 0n,
      };
      let txHash: unknown;
      try {
        // GenLayer Studio rejects a write whose fee value is zero, so the fee
        // distribution and fee value come from the node's current fee policy
        // rather than being guessed locally. The SDK's write-specific estimator
        // calls sim_estimateTransactionFees, which the current Studio node
        // rejects, so the policy-derived estimate is used.
        const fees = await client.estimateTransactionFees();
        if (fees.feeValue === undefined || BigInt(fees.feeValue) <= 0n) {
          throw new Error(`the Studio node reported a zero fee value for ${request.method}`);
        }
        txHash = await client.writeContract({ ...write, fees: { feeValue: fees.feeValue, distribution: fees.distribution } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(redact(`Reporter write ${request.method} failed: ${message}`, privateKey));
      }
      if (typeof txHash !== "string" || !TX_HASH_PATTERN.test(txHash)) {
        throw new Error(`Reporter write ${request.method} did not return a transaction hash`);
      }
      return { txHash, sender: account.address, recipient: options.contractAddress, submittedAt: now().toISOString() };
    },
    async close() {
      client = undefined;
      await bridge.close();
    },
  };
}
