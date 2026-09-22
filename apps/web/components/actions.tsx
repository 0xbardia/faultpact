"use client";

import { useState } from "react";
import { connectWallet, FAULTPACT_CHAIN_ID, sendFaultPactTransaction, waitForGenLayerFinalization, walletChainId, type GenLayerTransactionState } from "../lib/wallet";
import { formatAddress } from "../lib/format";
import { Panel } from "./ui";

type ActionStatus = "idle" | "connecting" | "ready" | "signing" | "processing" | "finalized" | "error";

export function ActionReview({ method, title, description, args, transaction, onFinalized }: { method: string; title: string; description: string; args: Array<[string, string]>; transaction?: { args: readonly unknown[]; value?: bigint }; onFinalized?: (state: GenLayerTransactionState) => void }) {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [address, setAddress] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [hash, setHash] = useState<string>();
  const [transactionState, setTransactionState] = useState<GenLayerTransactionState>();

  async function review() {
    setStatus("connecting"); setMessage(undefined);
    try {
      const wallet = await connectWallet();
      setAddress(wallet.address);
      if (wallet.chainId !== FAULTPACT_CHAIN_ID) { setStatus("error"); setMessage(`Switch the wallet to Chain ${FAULTPACT_CHAIN_ID} before reviewing this action.`); return; }
      setStatus("ready");
    } catch (error: unknown) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Wallet connection failed"); }
  }

  async function sign() {
    setStatus("signing"); setMessage(undefined);
    try {
      const wallet = address ? { address, chainId: await walletChainId() } : await connectWallet();
      setAddress(wallet.address);
      if (wallet.chainId !== FAULTPACT_CHAIN_ID) throw new Error(`Switch the wallet to Chain ${FAULTPACT_CHAIN_ID} before signing this action.`);
      if (!transaction) throw new Error("This action is review-only in the current product surface.");
      const txHash = await sendFaultPactTransaction(method, transaction.args, transaction.value ?? 0n);
      setHash(txHash); setStatus("processing");
      const finalState = await waitForGenLayerFinalization(txHash, (state) => setTransactionState(state));
      setTransactionState(finalState); setStatus("finalized"); onFinalized?.(finalState);
    } catch (error: unknown) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Wallet transaction failed"); }
  }

  const actionLabel = status === "connecting" ? "Checking wallet…" : status === "signing" ? "Confirm in wallet…" : status === "processing" ? "Waiting for finalization…" : status === "finalized" ? "Finalized" : status === "ready" && transaction ? "Sign with wallet" : status === "ready" ? "Re-check wallet" : status === "error" ? "Try again" : "Connect wallet to review";
  return <Panel className="action-review" title={title} kicker="Review before signing"><p>{description}</p><div className="action-method"><span>Contract method</span><b className="mono">{method}</b></div><div className="action-args">{args.map(([label, value]) => <div key={label}><span>{label}</span><b className="mono">{value}</b></div>)}</div>{status === "ready" ? <div className="action-ready"><span className="status-dot" />Wallet {formatAddress(address)} is on Chain {FAULTPACT_CHAIN_ID}.<strong>{transaction ? "Ready for a visible wallet confirmation." : "This action is currently review-only."}</strong></div> : null}{status === "processing" || status === "finalized" ? <div className="action-ready"><span className="status-dot" />GenLayer status: <strong>{transactionState?.status ?? "SUBMITTED"}</strong>{hash ? <small className="mono">{hash}</small> : null}<small>{status === "finalized" ? "Final state received. Indexed records may take a short moment to converge." : "The browser is waiting for the network decision; do not resubmit."}</small></div> : null}{status === "error" ? <div className="action-error" role="alert">{message}</div> : null}<button className="button button-dark" onClick={() => void (status === "ready" && transaction ? sign() : review())} disabled={status === "connecting" || status === "signing" || status === "processing" || status === "finalized"}>{actionLabel}</button>{status === "idle" ? <small className="muted">No key is sent to the server. User financial actions are signed by the connected wallet.</small> : null}</Panel>;
}
