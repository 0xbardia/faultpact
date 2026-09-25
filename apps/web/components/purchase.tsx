"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ActionReview } from "./actions";
import { apiGet, asRecord, asRows, text, waitForIndexed, type JsonRecord } from "../lib/api";
import { useApi } from "../lib/use-api";
import { formatBpsAsPercentage, formatDurationInput, formatDurationSeconds, formatGen, genDecimal, parseDurationInput, parseGen, rowValue } from "../lib/format";
import { ErrorState, Freshness, KeyValue, LoadingState, PageHeader, Panel } from "./ui";

export function PurchaseFlow({ selected }: { selected: string }) {
  const [coverageLimit, setCoverageLimit] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [createdCoverageId, setCreatedCoverageId] = useState("");
  const previousCoverageIds = useRef<Set<string>>(new Set());
  const list = useApi<Record<string, unknown>[]>("/pacts", { limit: 25 });
  const pacts = asRows(list.data?.data);
  const id = selected || rowValue(pacts[0], "onchainId", "0");
  const detail = useApi<Record<string, unknown>>(`/pacts/${id}`, undefined, refreshKey);
  const pact = asRecord(detail.data?.data);
  const terms = asRecord(pact.terms);
  const rawTerms = asRecord(terms.raw);
  const minAmount = rowValue(terms, "minCoverageAmount", "1");
  const maxAmount = rowValue(terms, "maxCoverageAmount", "0");
  const minDuration = rowValue(terms, "minCoverageDurationSeconds", "60");
  const maxDuration = rowValue(terms, "maxCoverageDurationSeconds", "0");
  const premiumBps = rowValue(terms, "premiumBpsPerYear", "0");
  const remaining = rowValue(asRecord(pact.capacity), "remaining", "0");
  const scope = rowValue(pact, "regionScope", rowValue(rawTerms, "region_scope", "Scope unavailable"));

  useEffect(() => {
    if (id !== "0") {
      setCoverageLimit(genDecimal(minAmount));
      setDurationSeconds(formatDurationInput(minDuration));
    }
  }, [id, minAmount, minDuration]);

  const limit = parseGen(coverageLimit);
  const parsedDuration = parseDurationInput(durationSeconds);
  const duration = parsedDuration ?? 0n;
  const bps = /^\d+$/.test(premiumBps) ? BigInt(premiumBps) : 0n;
  const minLimit = /^\d+$/.test(minAmount) ? BigInt(minAmount) : 0n;
  const maxLimit = /^\d+$/.test(maxAmount) ? BigInt(maxAmount) : 0n;
  const capacity = /^\d+$/.test(remaining) ? BigInt(remaining) : 0n;
  const minDurationValue = /^\d+$/.test(minDuration) ? BigInt(minDuration) : 0n;
  const maxDurationValue = /^\d+$/.test(maxDuration) ? BigInt(maxDuration) : 0n;
  const yearSeconds = 365n * 24n * 60n * 60n;
  const premium = limit && duration
    ? (((limit * bps * duration) + 10_000n * yearSeconds - 1n) / (10_000n * yearSeconds)) || 1n
    : 0n;
  const validPurchase = limit !== null && limit > 0n && parsedDuration !== null && duration > 0n && minLimit > 0n && maxLimit > 0n && minDurationValue > 0n && maxDurationValue > 0n
    && limit >= minLimit && limit <= maxLimit && limit <= capacity && duration >= minDurationValue && duration <= maxDurationValue;

  if (list.loading) return <LoadingState />;
  if (list.error) return <ErrorState message={list.error} />;
  if (!pacts.length) return <main className="content-shell"><PageHeader eyebrow="Customer workflow" title="No Coverage to review." description="There are no indexed Pacts available for purchase yet." actions={<Link className="button button-quiet" href="/pacts">← Browse Pacts</Link>} /></main>;
  if (detail.loading || detail.error) return <main className="content-shell">{detail.loading ? <LoadingState label="Loading Pact terms" /> : <ErrorState message={detail.error ?? "Pact terms unavailable"} />}</main>;

  return <main className="content-shell">
    <PageHeader eyebrow="Customer workflow" title="Review Coverage." description="Check the Provider, service, SLA and current capital before a wallet action. The contract confirms final capacity and price." actions={<Link className="button button-quiet" href="/pacts">← Browse Pacts</Link>} />
    <div className="purchase-grid">
      <Panel title={`Pact #${rowValue(pact, "onchainId", id)}`} kicker="Selected protection">
        <div className="kv-grid compact">
          <KeyValue label="Provider" value={text(asRecord(pact.provider).name, `Provider #${rowValue(pact, "providerId")}`)} />
          <KeyValue label="Service" value={text(asRecord(pact.service).name, `Service #${rowValue(asRecord(pact.service), "onchainId", rowValue(pact, "serviceId"))}`)} />
          <KeyValue label="Scope" value={scope} />
          <KeyValue label="P95 ceiling" value={`${rowValue(terms, "p95LatencyMs")} ms`} />
          <KeyValue label="Claim window" value={formatDurationSeconds(terms.claimWindowSeconds)} />
          <KeyValue label="Maximum Coverage" value={formatGen(terms.maxCoverageAmount)} />
        </div>
        <Freshness indexedAt={pact.indexedAt} />
      </Panel>
      <Panel title="Coverage terms" kicker="Before you sign">
        <div className="form-preview">
          <label>Coverage limit (GEN)
            <input inputMode="decimal" value={coverageLimit} onChange={(event) => setCoverageLimit(event.target.value.replace(/[^0-9.]/g, ""))} />
            <small>Allowed: {genDecimal(minAmount)} to {genDecimal(maxAmount)} GEN</small>
          </label>
          <label>Coverage duration
            <input inputMode="text" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value.replace(/[^0-9dhms ]/gi, ""))} placeholder="e.g. 30d or 720h" />
            <small>Use days, hours, minutes or seconds. Allowed: {formatDurationSeconds(minDuration)} to {formatDurationSeconds(maxDuration)}</small>
          </label>
        </div>
        <div className="kv-grid compact">
          <KeyValue label="Estimated premium" value={formatGen(premium)} />
          <KeyValue label="Premium rate" value={`${formatBpsAsPercentage(premiumBps)} per year`} />
          <KeyValue label="Capacity remaining" value={formatGen(remaining)} />
        </div>
        {!validPurchase
          ? <p className="review-warning" role="status">Enter a Coverage limit and duration within the Pact terms and available capital.</p>
          : <p className="muted">This estimate rounds up to the smallest GEN unit. The wallet shows the exact payment; the contract checks capacity again when the transaction executes.</p>}
      </Panel>
      <ActionReview key={`${id}:${coverageLimit}:${durationSeconds}`} method="buy_coverage" title="Coverage purchase review" description="The wallet submits this purchase to the frozen GenLayer deployment. The contract checks the amount and capacity again before creating Coverage." args={[["Pact", `#${id}`], ["Coverage limit", `${coverageLimit || "—"} GEN`], ["Duration", formatDurationSeconds(durationSeconds)], ["Maximum premium", formatGen(premium)], ["Wallet payment", formatGen(premium)]]} transaction={validPurchase ? { args: [BigInt(id), limit ?? 0n, duration, premium], value: premium } : undefined} disabledReason="Enter a Coverage limit and duration within the Pact terms and available capital." onWalletConnected={async (address) => { const existing = await apiGet<JsonRecord[]>("/coverages", { buyer: address, limit: 100 }); previousCoverageIds.current = new Set(asRows(existing.data).map((row) => rowValue(row, "onchainId"))); }} onFinalized={async (_state, address) => { const result = await waitForIndexed(() => apiGet<JsonRecord[]>("/coverages", { buyer: address, limit: 100 }), (current) => asRows(current.data).some((row) => !previousCoverageIds.current.has(rowValue(row, "onchainId")))); const created = asRows(result.data).find((row) => !previousCoverageIds.current.has(rowValue(row, "onchainId"))); if (created) setCreatedCoverageId(rowValue(created, "onchainId")); setRefreshKey((value) => value + 1); }} />
      {createdCoverageId ? <p className="action-ready" role="status">Coverage is indexed. <Link href={`/coverages/${createdCoverageId}`}>Open Coverage #{createdCoverageId} →</Link></p> : null}
    </div>
  </main>;
}

export function ClaimReview({ id }: { id: string }) {
  const state = useApi<Record<string, unknown>>(`/claims/${id}`);
  const claim = asRecord(state.data?.data);
  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error} />;
  return <main className="content-shell">
    <PageHeader eyebrow="Customer workspace / claim record" title={`Claim #${rowValue(claim, "onchainId", id)}`} description="This is an indexed claim receipt. Its status and payout come from the contract; follow the linked records to review Coverage terms and Incident facts." actions={<Link className="button button-quiet" href="/claims">← Claims</Link>} />
    <div className="purchase-grid"><Panel title="Claim result" kicker="Contract-backed state"><div className="kv-grid compact">
      <KeyValue label="Coverage" value={<Link href={`/coverages/${rowValue(claim, "coverageId")}`}>#{rowValue(claim, "coverageId")}</Link>} />
      <KeyValue label="Incident" value={<Link href={`/incidents/${rowValue(claim, "incidentId")}`}>#{rowValue(claim, "incidentId")}</Link>} />
      <KeyValue label="Status" value={rowValue(claim, "status")} />
      <KeyValue label="Payout" value={formatGen(claim.payout)} />
    </div><Freshness indexedAt={claim.indexedAt} /></Panel></div>
  </main>;
}
