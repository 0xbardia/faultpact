"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionReview } from "./actions";
import { EmptyState, ErrorState, Freshness, KeyValue, LoadingState, Metric, PageHeader, Panel, StatusBadge } from "./ui";
import { apiGet, asRecord, asRows, text, waitForIndexed, type JsonRecord } from "../lib/api";
import { formatAddress, formatGen, formatUnixSeconds, parseGen, rowValue } from "../lib/format";
import { connectWallet, FAULTPACT_CHAIN_ID, switchToFaultPact, walletBalance, walletErrorMessage } from "../lib/wallet";
import { useApi } from "../lib/use-api";

function digits(value: unknown): bigint | null {
  const raw = text(value, "");
  return /^\d+$/.test(raw) ? BigInt(raw) : null;
}

export function CustomerWorkspace() {
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [creditRefresh, setCreditRefresh] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [reviewWithdrawal, setReviewWithdrawal] = useState(false);
  const [externalBalance, setExternalBalance] = useState<bigint | null>(null);
  const [receiptMessage, setReceiptMessage] = useState("");
  const coverages = useApi<JsonRecord[]>("/coverages", address ? { buyer: address, limit: 100 } : { limit: 1 });
  const claims = useApi<JsonRecord[]>("/claims", address ? { claimant: address, limit: 100 } : { limit: 1 });
  const credit = useApi<JsonRecord>(address ? `/credits/${address}` : "/network", undefined, creditRefresh);
  const coverageRows = asRows(coverages.data?.data);
  const claimRows = asRows(claims.data?.data);
  const internalCredit = digits(asRecord(credit.data?.data).claimableCredit) ?? 0n;
  const parsedWithdrawal = parseGen(withdrawAmount);

  async function connect() {
    try {
      const wallet = await connectWallet();
      setAddress(wallet.address); setChainId(wallet.chainId); setError(""); setReceiptMessage("");
      try { setExternalBalance(await walletBalance(wallet.address)); } catch { setExternalBalance(null); }
    } catch (cause: unknown) { setError(walletErrorMessage(cause)); }
  }
  async function switchNetwork() {
    try { await switchToFaultPact(); await connect(); }
    catch (cause: unknown) { setError(walletErrorMessage(cause)); }
  }

  return <main className="content-shell dashboard-shell">
    <PageHeader eyebrow="Customer workspace" title="Track protection and settlement." description="Browse without a wallet. Connect when you want to inspect your Coverage, file a Claim, or withdraw claimable internal credit." actions={<Link className="button button-coral" href="/pacts">Find a Pact ↗</Link>} />
    <Panel title="Customer wallet" kicker="Public address and network">
      {!address ? <button className="button button-dark" onClick={() => void connect()}>Connect wallet</button> : <div className="kv-grid compact"><KeyValue label="Wallet" value={formatAddress(address)} mono /><KeyValue label="Network" value={chainId === null ? "Unavailable" : `Chain ${chainId}`} /></div>}
      {address && chainId !== FAULTPACT_CHAIN_ID ? <p className="review-warning" role="status">FaultPact writes require Chain 61997. <button className="text-button" onClick={() => void switchNetwork()}>Switch network</button></p> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </Panel>
    {address ? <>
      <div className="detail-grid">
        <Panel title="Your Coverage" kicker="Indexed contract records">{coverages.loading ? <LoadingState /> : coverages.error ? <ErrorState message={coverages.error} /> : coverageRows.length ? <div className="customer-record-list">{coverageRows.map((row) => <Link key={rowValue(row, "onchainId")} href={`/coverages/${rowValue(row, "onchainId")}`}><span><strong>Coverage #{rowValue(row, "onchainId")}</strong><small>{rowValue(asRecord(row.pact), "regionScope", `Pact #${rowValue(row, "pactId")}`)}</small></span><span>{formatGen(row.coverageLimit)} · {rowValue(row, "status")}</span></Link>)}</div> : <EmptyState title="No Coverage found for this wallet" description="Browse published Pacts and compare the terms before you buy." action={<Link className="text-link" href="/pacts">Browse Pacts →</Link>} />}<Freshness indexedAt={coverages.data?.indexedAt} /></Panel>
        <Panel title="Your Claims" kicker="Contract-backed results">{claims.loading ? <LoadingState /> : claims.error ? <ErrorState message={claims.error} /> : claimRows.length ? <div className="customer-record-list">{claimRows.map((row) => <Link key={rowValue(row, "onchainId")} href={`/claims/${rowValue(row, "onchainId")}`}><span><strong>Claim #{rowValue(row, "onchainId")}</strong><small>{rowValue(row, "status")}</small></span><span>{formatGen(row.payout)}</span></Link>)}</div> : <EmptyState title="No Claims filed" description="Open a Coverage to see matching Incidents and file a Claim before its deadline." />}<Freshness indexedAt={claims.data?.indexedAt} /></Panel>
      </div>
      <Panel title="FAULTPACT INTERNAL CREDIT" kicker="Read from the frozen contract">
        {credit.loading ? <LoadingState label="Reading claimable balance" /> : credit.error ? <ErrorState message="Claimable credit is temporarily unavailable. Retry after the Studio RPC recovers." retry={() => setCreditRefresh((value) => value + 1)} /> : <>
          <div className="term-grid capacity-grid"><Metric label="Claimable internal credit" value={formatGen(internalCredit.toString())} tone="accent" compactValue /><Metric label="External GEN in wallet" value={externalBalance === null ? "Not observed" : formatGen(externalBalance.toString())} detail="current wallet balance" compactValue /></div>
          <p className="muted">Internal credit is a FaultPact contract balance. A withdrawal requests an external GEN transfer. The transaction and a wallet balance change must both be observed before FaultPact says GEN was received.</p>
          <label>Amount to withdraw (GEN)<input inputMode="decimal" value={withdrawAmount} onChange={(event) => { setWithdrawAmount(event.target.value.replace(/[^0-9.]/g, "")); setReviewWithdrawal(false); setReceiptMessage(""); }} placeholder="0.5" /><small>Available internal credit: {formatGen(internalCredit.toString())}</small></label>
          {reviewWithdrawal && parsedWithdrawal && parsedWithdrawal > 0n && parsedWithdrawal <= internalCredit ? <ActionReview method="withdraw_credit" title="Withdraw claimable credit" description="The contract debits the selected internal credit and requests an external GEN transfer to this wallet. F-06 can prevent recovery if the GenLayer runtime fails during that transfer." args={[["FaultPact internal credit", formatGen(internalCredit.toString())], ["Withdrawal requested", formatGen(parsedWithdrawal)], ["External receipt", "Checked after finalization"]]} transaction={{ args: [parsedWithdrawal] }} onWalletConnected={(walletAddress) => { if (walletAddress.toLowerCase() !== address.toLowerCase()) throw new Error("The selected wallet differs from the displayed customer account. Refresh and review again."); }} onFinalized={async (_state, walletAddress) => {
            await waitForIndexed(() => apiGet<JsonRecord>(`/credits/${walletAddress}`), (result) => (digits(asRecord(result.data).claimableCredit) ?? 0n) <= internalCredit - parsedWithdrawal);
            const after = await walletBalance(walletAddress).catch(() => null);
            if (externalBalance !== null && after !== null && after - externalBalance >= parsedWithdrawal) setReceiptMessage("EXTERNAL GEN RECEIVED — wallet balance increased by at least the requested amount after finalization.");
            else setReceiptMessage("Internal credit was debited, but an external GEN balance increase was not verified. Do not treat this as funds received; F-06 is an accepted runtime limitation.");
            if (after !== null) setExternalBalance(after);
            setCreditRefresh((value) => value + 1);
          }} /> : <button className="button button-dark" disabled={chainId !== FAULTPACT_CHAIN_ID || !parsedWithdrawal || parsedWithdrawal <= 0n || parsedWithdrawal > internalCredit} onClick={() => setReviewWithdrawal(true)}>Review credit withdrawal</button>}
          {receiptMessage ? <p className={receiptMessage.startsWith("EXTERNAL GEN RECEIVED") ? "action-ready" : "review-warning"} role="status">{receiptMessage}</p> : null}
        </>}
      </Panel>
    </> : <Panel title="Browse before connecting" kicker="No wallet required"><p>Explore Providers, Services, Pacts, Incidents, Evidence, and documentation. Your wallet is only needed for a user action.</p><Link className="text-link" href="/explore">Explore FaultPact →</Link></Panel>}
  </main>;
}

function epochSeconds(value: unknown): bigint | null {
  const raw = text(value, "");
  if (/^\d+$/.test(raw)) return BigInt(raw);
  const milliseconds = Date.parse(raw);
  return Number.isFinite(milliseconds) ? BigInt(Math.floor(milliseconds / 1000)) : null;
}

export function CoverageClaimFlow({ coverage }: { coverage: JsonRecord }) {
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [newClaimId, setNewClaimId] = useState("");
  const buyer = rowValue(coverage, "buyerAddress", "");
  const coverageId = rowValue(coverage, "onchainId");
  const pact = asRecord(coverage.pact);
  const service = asRecord(pact.service);
  const serviceId = rowValue(service, "onchainId", "");
  const terms = asRecord(pact.terms);
  const raw = asRecord(coverage.raw);
  const claimWindow = digits(terms.claimWindowSeconds);
  const endsAt = epochSeconds(coverage.endAt);
  const deadline = digits(raw.claim_deadline_ts) ?? (endsAt !== null && claimWindow !== null ? endsAt + claimWindow : null);
  const deadlinePassed = deadline === null || BigInt(Math.floor(Date.now() / 1000)) > deadline;
  const incidentsState = useApi<JsonRecord[]>(serviceId ? "/incidents" : "/incidents", serviceId ? { serviceId, limit: 100 } : { limit: 1 });
  const claimsState = useApi<JsonRecord[]>(buyer ? "/claims" : "/claims", buyer ? { claimant: buyer, limit: 100 } : { limit: 1 });
  const incidents = asRows(incidentsState.data?.data);
  const claims = asRows(claimsState.data?.data);
  const coverageStart = epochSeconds(coverage.startAt);
  const coverageEnd = endsAt;
  const eligibleIncidents = incidents.map((incident) => {
    const start = digits(incident.observedStart), end = digits(incident.observedEnd);
    const overlaps = coverageStart !== null && coverageEnd !== null && start !== null && end !== null && coverageStart < end && start < coverageEnd;
    const duplicate = claims.some((claim) => text(claim.coverageId) === text(coverage.id) && text(claim.incidentId) === text(incident.id));
    const status = rowValue(incident, "status").toUpperCase();
    const reason = rowValue(coverage, "status").toUpperCase() === "RELEASED" ? "Coverage backing was released" : deadlinePassed ? "Claim deadline passed" : duplicate ? "Claim already filed" : !overlaps ? "Incident period does not overlap Coverage" : "Eligible to file while facts are resolving";
    return { incident, overlaps, duplicate, reason, status };
  });
  const selected = eligibleIncidents.find((item) => rowValue(item.incident, "onchainId") === incidentId) ?? eligibleIncidents[0];
  const canFile = Boolean(address && address.toLowerCase() === buyer.toLowerCase() && chainId === FAULTPACT_CHAIN_ID && selected && selected.overlaps && !selected.duplicate && !deadlinePassed && rowValue(coverage, "status").toUpperCase() !== "RELEASED");
  const previousClaimIds = new Set(claims.map((claim) => rowValue(claim, "onchainId")));

  async function connect() {
    try { const wallet = await connectWallet(); setAddress(wallet.address); setChainId(wallet.chainId); setError(""); }
    catch (cause: unknown) { setError(walletErrorMessage(cause)); }
  }
  async function switchNetwork() {
    try { await switchToFaultPact(); await connect(); }
    catch (cause: unknown) { setError(walletErrorMessage(cause)); }
  }

  return <Panel title="File a Claim" kicker="Coverage and Incident must match">
    <div className="kv-grid compact"><KeyValue label="Claim deadline" value={deadline === null ? "Unavailable" : formatUnixSeconds(String(deadline))} /><KeyValue label="Incident facts" value="May still be resolving" /></div>
    <p className="muted">Filing records the Coverage/Incident pair and preserves the Claim lifecycle. You may need to file before the Incident is finalized; filing does not mean the Claim is eligible for payout.</p>
    {incidentsState.loading || claimsState.loading ? <LoadingState label="Checking matching Incidents and Claims" /> : incidentsState.error ? <ErrorState message={incidentsState.error} /> : eligibleIncidents.length ? <>
      <label className="form-select">Incident overlapping this Coverage period<select value={incidentId || rowValue(selected?.incident, "onchainId")} onChange={(event) => setIncidentId(event.target.value)}>{eligibleIncidents.map(({ incident, reason, status }) => <option key={rowValue(incident, "onchainId")} value={rowValue(incident, "onchainId")} disabled={reason !== "Eligible to file while facts are resolving"}>{`Incident #${rowValue(incident, "onchainId")} · ${status} · ${reason}`}</option>)}</select></label>
      {selected ? <div className="claim-candidate"><StatusBadge value={selected.status} /><span>Incident #{rowValue(selected.incident, "onchainId")} · {selected.reason}</span><small>Observed {formatUnixSeconds(selected.incident.observedStart)}</small></div> : null}
      {!address ? <button className="button button-dark" onClick={() => void connect()}>Connect Coverage owner wallet</button> : address.toLowerCase() !== buyer.toLowerCase() ? <p className="review-warning" role="status">The connected wallet does not own this Coverage.</p> : chainId !== FAULTPACT_CHAIN_ID ? <p className="review-warning" role="status">Switch to Chain 61997 before filing. <button className="text-button" onClick={() => void switchNetwork()}>Switch network</button></p> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
      {canFile && selected ? <ActionReview method="file_claim" title="Claim filing review" description="The contract will verify the Coverage owner, Incident service and period, deadline, and duplicate status. It records the Claim before any final payout decision." args={[["Coverage", `#${coverageId}`], ["Incident", `#${rowValue(selected.incident, "onchainId")}`], ["Claim deadline", deadline === null ? "Unavailable" : formatUnixSeconds(String(deadline))], ["Incident state", selected.status], ["Potential payout", "Not decided by GenLayer alone"]]} transaction={{ args: [BigInt(coverageId), BigInt(rowValue(selected.incident, "onchainId"))] }} onWalletConnected={(walletAddress) => { if (walletAddress.toLowerCase() !== buyer.toLowerCase()) throw new Error("This wallet does not own the selected Coverage."); }} onFinalized={async (_state, walletAddress) => { const targetIncidentId = rowValue(selected.incident, "onchainId"); const result = await waitForIndexed(() => apiGet<JsonRecord[]>("/claims", { claimant: walletAddress, incidentId: targetIncidentId, limit: 100 }), (current) => asRows(current.data).some((claim) => !previousClaimIds.has(rowValue(claim, "onchainId")) && text(claim.coverageId) === text(coverage.id) && text(claim.incidentId) === text(selected.incident.id))); const created = asRows(result.data).find((claim) => !previousClaimIds.has(rowValue(claim, "onchainId")) && text(claim.coverageId) === text(coverage.id) && text(claim.incidentId) === text(selected.incident.id)); if (created) setNewClaimId(rowValue(created, "onchainId")); }} /> : null}
      {newClaimId ? <p className="action-ready" role="status">Claim indexed. <Link href={`/claims/${newClaimId}`}>Track Claim #{newClaimId} →</Link></p> : null}
    </> : <EmptyState title="No matching Incident indexed" description="No Incident overlaps this Coverage’s Service and active period yet. Revisit this Coverage if one is opened." />}
    {deadlinePassed ? <p className="review-warning">This Coverage’s Claim deadline has passed.</p> : null}
    <Freshness indexedAt={incidentsState.data?.indexedAt} />
  </Panel>;
}
