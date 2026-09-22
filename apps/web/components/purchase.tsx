"use client";

import Link from "next/link";
import { ActionReview } from "./actions";
import { asRecord, asRows } from "../lib/api";
import { useEffect, useState } from "react";
import { useApi } from "../lib/use-api";
import { formatGen, rowValue } from "../lib/format";
import { ErrorState, Freshness, KeyValue, LoadingState, PageHeader, Panel } from "./ui";

export function PurchaseFlow({ selected }: { selected: string }) {
  const [coverageLimit, setCoverageLimit] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const list = useApi<Record<string, unknown>[]>("/pacts", { limit: 25 });
  const pacts = asRows(list.data?.data);
  const pact = asRecord(pacts.find((row) => rowValue(row, "onchainId") === selected) ?? pacts[0]);
  const id = rowValue(pact, "onchainId", "0");
  const detail = useApi<Record<string, unknown>>(id !== "0" ? `/pacts/${id}` : "/stats", undefined, refreshKey);
  const selectedPact = asRecord(detail.data?.data);
  const terms = asRecord(selectedPact.terms);
  const rawTerms = asRecord(asRecord(selectedPact.raw).terms);
  const scope = rowValue(selectedPact, "regionScope", rowValue(terms, "regionScope", rowValue(rawTerms, "region_scope", "global")));
  const minAmount = rowValue(terms, "minCoverageAmount", rowValue(rawTerms, "min_coverage_amount", "1"));
  const maxAmount = rowValue(terms, "maxCoverageAmount", rowValue(rawTerms, "max_coverage_amount", "0"));
  const minDuration = rowValue(terms, "minCoverageDurationSeconds", rowValue(rawTerms, "min_coverage_duration_seconds", "60"));
  const maxDuration = rowValue(terms, "maxCoverageDurationSeconds", rowValue(rawTerms, "max_coverage_duration_seconds", "0"));
  const premiumBps = rowValue(terms, "premiumBpsPerYear", rowValue(rawTerms, "premium_bps_per_year", "0"));
  const rawPact = asRecord(selectedPact.raw);
  const remainingCapacity = rowValue(asRecord(selectedPact.capacity), "remaining", rowValue(asRecord(rawPact.capacity), "remaining", "0"));
  useEffect(() => { if (id !== "0") { setCoverageLimit(minAmount); setDurationSeconds(minDuration); } }, [id, minAmount, minDuration]);
  const limit = /^\d+$/.test(coverageLimit) ? BigInt(coverageLimit) : 0n;
  const duration = /^\d+$/.test(durationSeconds) ? BigInt(durationSeconds) : 0n;
  const bps = /^\d+$/.test(premiumBps) ? BigInt(premiumBps) : 0n;
  const denominator = 10000n * 365n * 24n * 60n * 60n;
  const calculatedPremium = limit > 0n && duration > 0n && bps > 0n ? ((limit * bps * duration) + denominator - 1n) / denominator : 0n;
  const premium = calculatedPremium < 1n && bps > 0n ? 1n : calculatedPremium;
  const validPurchase = limit > 0n && duration > 0n && limit >= BigInt(minAmount) && limit <= BigInt(maxAmount) && limit <= BigInt(remainingCapacity) && duration >= BigInt(minDuration) && duration <= BigInt(maxDuration);
  if (list.loading) return <LoadingState />;
  if (list.error) return <ErrorState message={list.error} />;
  if (!pacts.length) return <main className="content-shell"><PageHeader eyebrow="Customer workflow" title="No Coverage to review." description="There are no indexed Pacts available for purchase yet." actions={<Link className="button button-quiet" href="/pacts">← Browse Pacts</Link>} /></main>;
  if (detail.loading || detail.error) return <main className="content-shell">{detail.loading ? <LoadingState label="Loading Pact terms" /> : <ErrorState message={detail.error ?? "Pact terms unavailable"} />}</main>;
  return <main className="content-shell"><PageHeader eyebrow="Customer workflow" title="Review Coverage." description="The contract determines capacity, premium, deadlines, and final settlement. This screen exposes the terms before a wallet action." actions={<Link className="button button-quiet" href="/pacts">← Browse Pacts</Link>} /><div className="purchase-grid"><Panel title={`Pact #${rowValue(selectedPact, "onchainId", id)}`} kicker="Selected protection"><div className="kv-grid compact"><KeyValue label="Scope" value={scope} /><KeyValue label="P95 ceiling" value={`${rowValue(terms, "p95LatencyMs", rowValue(rawTerms, "p95_latency_ms"))} ms`} /><KeyValue label="Claim window" value={`${rowValue(terms, "claimWindowSeconds", rowValue(rawTerms, "claim_window_seconds"))} seconds`} /><KeyValue label="Max Coverage" value={formatGen(terms.maxCoverageAmount ?? rawTerms.max_coverage_amount)} /></div><Freshness indexedAt={selectedPact.indexedAt} /></Panel><Panel title="Coverage terms" kicker="Exact integer inputs"><div className="form-preview"><label>Coverage limit<input inputMode="numeric" value={coverageLimit} onChange={(event) => setCoverageLimit(event.target.value.replace(/[^0-9]/g, ""))} /></label><label>Duration (seconds)<input inputMode="numeric" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value.replace(/[^0-9]/g, ""))} /></label></div><div className="kv-grid compact"><KeyValue label="Estimated premium" value={formatGen(premium)} /><KeyValue label="Capacity remaining" value={formatGen(remainingCapacity)} /><KeyValue label="Payment value" value={`${premium.toString()} wei`} /></div>{!validPurchase ? <p className="review-warning" role="status">Capacity or term data is incomplete; signing stays disabled until the indexed Pact state is available.</p> : <p className="muted">The wallet will show the native GEN payment and the exact frozen contract arguments before signing.</p>}</Panel><ActionReview method="buy_coverage" title="Coverage purchase review" description="This call is sent through the browser wallet to the frozen GenLayer deployment. A final state is shown only after the network reports it." args={[["pact_id", id], ["coverage_limit", coverageLimit || "—"], ["duration_seconds", durationSeconds || "—"], ["max_premium", premium.toString()], ["payment", `${premium.toString()} wei`]]} transaction={validPurchase ? { args: [BigInt(id), limit, duration, premium], value: premium } : undefined} onFinalized={() => setRefreshKey((value) => value + 1)} /></div></main>;
}

export function ClaimReview({ id }: { id: string }) {
  const state = useApi<Record<string, unknown>>(`/claims/${id}`);
  const claim = asRecord(state.data?.data);
  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error} />;
  return <main className="content-shell"><PageHeader eyebrow="Customer workflow / claim" title={`Claim #${rowValue(claim, "onchainId", id)}`} description="File while the Coverage deadline is open. The final claim result comes from the contract, not this preview." actions={<Link className="button button-quiet" href="/claims">← Claims</Link>} /><div className="purchase-grid"><Panel title="Current indexed claim" kicker="Not a receipt"><div className="kv-grid compact"><KeyValue label="Coverage" value={`#${rowValue(claim, "coverageId")}`} /><KeyValue label="Incident" value={`#${rowValue(claim, "incidentId")}`} /><KeyValue label="Status" value={rowValue(claim, "status")} /><KeyValue label="Stored payout" value={formatGen(claim.payout)} /></div></Panel><ActionReview method="file_claim" title="Claim filing review" description="A claim binds one Coverage to one Incident. Review the deadline and current Incident state before signing." args={[["coverage_id", rowValue(claim, "coverageId")], ["incident_id", rowValue(claim, "incidentId")]]} /></div></main>;
}
