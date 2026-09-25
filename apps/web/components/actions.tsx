"use client";

import { useEffect, useRef, useState } from "react";
import { connectWallet, FAULTPACT_CHAIN_ID, getStudioFeePreset, provider, sendFaultPactTransaction, switchToFaultPact, waitForGenLayerFinalization, walletChainId, walletErrorMessage, type GenLayerTransactionState, type StudioFeePreset } from "../lib/wallet";
import { formatAddress, formatGen } from "../lib/format";
import { Panel } from "./ui";

type ActionStatus = "idle" | "connecting" | "wrongNetwork" | "ready" | "signing" | "processing" | "converging" | "finalized" | "error";
type PendingTransaction = { method: string; hash: string; address: string; submittedAt: number };

export function ActionReview({ method, title, description, args, transaction, disabledReason, onWalletConnected, onFinalized }: { method: string; title: string; description: string; args: Array<[string, string]>; transaction?: { args: readonly unknown[]; value?: bigint }; disabledReason?: string; onWalletConnected?: (address: string) => void | Promise<void>; onFinalized?: (state: GenLayerTransactionState, address: string) => void | Promise<void> }) {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [address, setAddress] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [technical, setTechnical] = useState<string>();
  const [hash, setHash] = useState<string>();
  const [feePreset, setFeePreset] = useState<StudioFeePreset>();
  const [transactionState, setTransactionState] = useState<GenLayerTransactionState>();
  const [needsConvergence, setNeedsConvergence] = useState(false);
  const [terminalFailure, setTerminalFailure] = useState(false);
  const busy = useRef(false);
  const statusRef = useRef(status);
  const onFinalizedRef = useRef(onFinalized);
  statusRef.current = status;
  onFinalizedRef.current = onFinalized;

  function storageKey() { return `faultpact:pending:${window.location.pathname}:${method}`; }

  async function monitor(pending: PendingTransaction) {
    let finalized = false;
    setHash(pending.hash);
    setAddress(pending.address);
    setStatus("processing");
    setTerminalFailure(false);
    setMessage("GenLayer is deciding this transaction. Do not submit it again.");
    setTechnical(undefined);
    busy.current = true;
    try {
      const finalState = await waitForGenLayerFinalization(pending.hash, (state) => {
        setTransactionState(state);
        setMessage(state.status === "RPC_DEGRADED"
          ? "Studio is temporarily rate limiting checks. The transaction is not confirmed final; keep the hash and do not resubmit."
          : "GenLayer is deciding this transaction. Do not submit it again.");
      });
      finalized = true;
      setTransactionState(finalState);
      setStatus("converging");
      setMessage("Finalized on GenLayer. Waiting for the indexed record to reach FaultPact.");
      await onFinalizedRef.current?.(finalState, pending.address);
      try { sessionStorage.removeItem(storageKey()); } catch { /* Browser storage may be disabled. */ }
      setNeedsConvergence(false);
      setStatus("finalized");
      setMessage(onFinalizedRef.current ? "Finalized and reflected in the indexed product state." : "Finalized on GenLayer.");
    } catch (error: unknown) {
      const technicalMessage = error instanceof Error ? error.message : String(error);
      const isTerminal = /Consensus submission reverted before GenLayer accepted it|GenLayer transaction (?:reverted|failed|rejected|cancelled|canceled)|GenLayer finalized this transaction, but the FaultPact action failed/i.test(technicalMessage);
      setNeedsConvergence(finalized);
      setStatus(finalized ? "finalized" : "error");
      setTerminalFailure(isTerminal);
      setMessage(finalized ? "GenLayer finalized this transaction, but indexed state has not converged yet. Keep the hash and do not resubmit." : walletErrorMessage(error));
      setTechnical(technicalMessage);
      if (isTerminal) { try { sessionStorage.removeItem(storageKey()); } catch { /* Browser storage may be disabled. */ } }
    } finally { busy.current = false; }
  }

  useEffect(() => {
    const key = storageKey();
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const pending = JSON.parse(raw) as PendingTransaction;
      if (pending.method === method && typeof pending.hash === "string" && typeof pending.address === "string") void monitor(pending);
    } catch { try { sessionStorage.removeItem(key); } catch { /* Browser storage may be disabled. */ } }
  // Restore once when this action is mounted after a page refresh.
  }, [method]);

  useEffect(() => {
    const injected = provider();
    if (!injected?.on) return;
    const accountsChanged = (...values: unknown[]) => {
      const accounts = Array.isArray(values[0]) ? values[0] as string[] : [];
      setAddress(accounts[0]);
      if (["ready", "wrongNetwork"].includes(statusRef.current)) {
        setStatus("idle");
        setFeePreset(undefined);
        setMessage("The selected wallet account changed. Review the action again before signing.");
      }
    };
    const chainChanged = (...values: unknown[]) => {
      const chain = typeof values[0] === "string" ? Number.parseInt(values[0], 16) : null;
      if (chain !== FAULTPACT_CHAIN_ID && ["ready", "wrongNetwork"].includes(statusRef.current)) {
        setStatus("wrongNetwork");
        setFeePreset(undefined);
        setMessage(`Switch the wallet to Chain ${FAULTPACT_CHAIN_ID} before signing.`);
      }
    };
    injected.on("accountsChanged", accountsChanged);
    injected.on("chainChanged", chainChanged);
    return () => { injected.removeListener?.("accountsChanged", accountsChanged); injected.removeListener?.("chainChanged", chainChanged); };
  }, []);

  async function review() {
    if (busy.current) return;
    busy.current = true;
    setFeePreset(undefined);
    setStatus("connecting"); setMessage(undefined); setTechnical(undefined);
    try {
      const wallet = await connectWallet();
      setAddress(wallet.address);
      if (wallet.chainId !== FAULTPACT_CHAIN_ID) { setStatus("wrongNetwork"); setMessage(`Switch the wallet to Chain ${FAULTPACT_CHAIN_ID} before signing.`); return; }
      await onWalletConnected?.(wallet.address);
      setFeePreset(await getStudioFeePreset());
      setStatus("ready");
    } catch (error: unknown) { setStatus("error"); setMessage(walletErrorMessage(error)); setTechnical(error instanceof Error ? error.message : String(error)); }
    finally { busy.current = false; }
  }

  async function sign() {
    if (busy.current || !transaction) return;
    busy.current = true;
    setStatus("signing"); setMessage(undefined); setTechnical(undefined);
    try {
      const wallet = await connectWallet();
      setAddress(wallet.address);
      if (wallet.chainId !== FAULTPACT_CHAIN_ID) { setStatus("wrongNetwork"); setMessage(`Switch the wallet to Chain ${FAULTPACT_CHAIN_ID} before signing.`); return; }
      await onWalletConnected?.(wallet.address);
      if (!feePreset) throw new Error("Review the current GenLayer fee estimate before signing.");
      const txHash = await sendFaultPactTransaction(method, transaction.args, transaction.value ?? 0n, address, feePreset);
      const pending = { method, hash: txHash, address: wallet.address, submittedAt: Date.now() } satisfies PendingTransaction;
      try { sessionStorage.setItem(storageKey(), JSON.stringify(pending)); } catch { setTechnical("Browser session storage is unavailable; keep this page open while the transaction is pending."); }
      setHash(txHash);
      busy.current = false;
      await monitor(pending);
    } catch (error: unknown) {
      setStatus("error"); setMessage(walletErrorMessage(error)); setTechnical(error instanceof Error ? error.message : String(error));
      busy.current = false;
    }
  }

  async function switchNetwork() {
    if (busy.current) return;
    busy.current = true; setStatus("connecting"); setMessage(undefined); setFeePreset(undefined);
    try {
      await switchToFaultPact();
      const wallet = await connectWallet();
      setAddress(wallet.address);
      if (wallet.chainId === FAULTPACT_CHAIN_ID) {
        await onWalletConnected?.(wallet.address);
        setFeePreset(await getStudioFeePreset());
      } else setFeePreset(undefined);
      setStatus(wallet.chainId === FAULTPACT_CHAIN_ID ? "ready" : "wrongNetwork");
      if (wallet.chainId !== FAULTPACT_CHAIN_ID) setMessage(`Switch the wallet to Chain ${FAULTPACT_CHAIN_ID} before signing.`);
    }
    catch (error: unknown) { setStatus("wrongNetwork"); setMessage(walletErrorMessage(error)); setTechnical(error instanceof Error ? error.message : String(error)); }
    finally { busy.current = false; }
  }

  const actionLabel = !transaction ? "Action unavailable" : status === "connecting" ? "Checking wallet…" : status === "signing" ? "Confirm in wallet…" : status === "processing" ? "Waiting for finalization…" : status === "converging" ? "Waiting for indexed state…" : status === "finalized" && needsConvergence ? "Retry index check" : status === "finalized" ? "Finalized" : status === "ready" ? "Sign with wallet" : status === "error" && hash ? "Check transaction status" : status === "error" ? "Try again" : status === "wrongNetwork" ? "Switch to Chain 61997" : "Connect wallet to review";
  const displayedActionLabel = terminalFailure ? "Review a new transaction" : actionLabel;
  const busyStatus = ["connecting", "signing", "processing", "converging"].includes(status);
  function clearTerminalFailure() {
    setStatus("idle"); setTerminalFailure(false); setHash(undefined); setTransactionState(undefined); setMessage(undefined); setTechnical(undefined); setFeePreset(undefined);
  }
  return <Panel className="action-review" title={title} kicker="Review before signing">
    <p>{description}</p>
    <div className="action-args">{args.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    {status === "ready" ? <div className="action-ready"><span className="status-dot" />Wallet {formatAddress(address)} is on Chain {FAULTPACT_CHAIN_ID}.<strong>Ready for a visible wallet confirmation.</strong></div> : null}
    {feePreset && transaction && !["processing", "converging", "finalized"].includes(status) ? <div className="action-args fee-review"><div><span>GenLayer fee deposit</span><b>{formatGen(feePreset.feeValue.toString())}</b></div>{(transaction.value ?? 0n) > 0n ? <div><span>Total sent with transaction</span><b>{formatGen((transaction.value! + feePreset.feeValue).toString())}</b></div> : null}<small className="muted">The wallet sends this deposit with the action. Final fee accounting depends on network execution.</small></div> : null}
    {["processing", "converging", "finalized"].includes(status) ? <div className="action-ready" role="status"><span className="status-dot" />GenLayer status: <strong>{transactionState?.status ?? "SUBMITTED"}</strong>{hash ? <small className="mono">{hash}</small> : null}<small>{message}</small></div> : null}
    {status === "error" || status === "wrongNetwork" ? <div className="action-error" role="alert">{message}{hash ? <small className="mono">{hash}</small> : null}{technical ? <details><summary>Technical details</summary><code>{technical}</code></details> : null}</div> : null}
    {!transaction && status === "idle" ? <p className="review-warning" role="status">{disabledReason ?? "This action is unavailable with the current indexed state."}</p> : null}
    <details className="raw-details action-technical"><summary>Contract transaction details</summary><div><span>Method</span><code>{method}</code></div><pre>{JSON.stringify(args.map(([label, value]) => ({ [label]: value })), null, 2)}</pre></details>
    {status === "wrongNetwork" ? <button className="button button-dark" onClick={() => void switchNetwork()} disabled={busyStatus}>{displayedActionLabel}</button> : <button className="button button-dark" onClick={() => void (terminalFailure ? clearTerminalFailure() : status === "ready" ? sign() : hash && (status === "error" || needsConvergence) ? monitor({ method, hash, address: address ?? "", submittedAt: Date.now() }) : review())} disabled={!transaction || busyStatus || (status === "finalized" && !needsConvergence)}>{displayedActionLabel}</button>}
    {status === "idle" && transaction ? <small className="muted">No key is sent to FaultPact servers. Your wallet signs this action.</small> : null}
  </Panel>;
}
