"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionReview } from "./actions";
import { ErrorState, Freshness, KeyValue, LoadingState, Metric, PageHeader, Panel } from "./ui";
import { apiGet, asRecord, asRows, text, waitForIndexed, type JsonRecord } from "../lib/api";
import { formatAddress, formatBpsAsPercentage, formatDurationInput, formatDurationSeconds, formatGen, formatPpmAsPercentage, formatUnixSeconds, genDecimal, parseBpsPercent, parseDurationInput, parseGen, parsePpmPercent, rowValue } from "../lib/format";
import { connectWallet, FAULTPACT_CHAIN_ID, switchToFaultPact, walletErrorMessage } from "../lib/wallet";
import { useApi } from "../lib/use-api";

type ProviderRecord = JsonRecord;

function useProviderAccount() {
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const records = useApi<JsonRecord[]>("/providers", address ? { search: address, limit: 100 } : { limit: 1 }, refresh);
  const providers = asRows(records.data?.data).filter((row) => rowValue(row, "address", "").toLowerCase() === address.toLowerCase());
  async function connect() {
    try { const wallet = await connectWallet(); setAddress(wallet.address); setChainId(wallet.chainId); setError(""); }
    catch (cause: unknown) { setError(walletErrorMessage(cause)); }
  }
  async function switchNetwork() {
    try { await switchToFaultPact(); await connect(); }
    catch (cause: unknown) { setError(walletErrorMessage(cause)); }
  }
  return { address, chainId, error, records, providers, connect, switchNetwork, revision: refresh, refresh: () => setRefresh((value) => value + 1) };
}

function ProviderIdentity({ wallet, providerId, onProviderChange }: { wallet: ReturnType<typeof useProviderAccount>; providerId: string; onProviderChange: (id: string) => void }) {
  return <Panel title="Connected Provider" kicker="Wallet controls ownership">
    {!wallet.address ? <button className="button button-dark" onClick={() => void wallet.connect()}>Connect wallet</button> : <>
      <div className="kv-grid compact"><KeyValue label="Wallet" value={formatAddress(wallet.address)} mono /><KeyValue label="Network" value={wallet.chainId === null ? "Unavailable" : `Chain ${wallet.chainId}`} /></div>
      {wallet.chainId !== FAULTPACT_CHAIN_ID ? <p className="review-warning" role="status">Writes require GenLayer Studio Development Preview (Chain 61997). <button className="text-button" onClick={() => void wallet.switchNetwork()}>Switch network</button></p> : null}
      {wallet.records.loading ? <LoadingState label="Finding Provider records" /> : wallet.records.error ? <ErrorState message={wallet.records.error} retry={wallet.refresh} /> : wallet.providers.length ? <label className="form-select">Provider record
        <select value={providerId} onChange={(event) => onProviderChange(event.target.value)}>
          {wallet.providers.map((row) => <option key={rowValue(row, "onchainId")} value={rowValue(row, "onchainId")}>{text(row.name)} · #{rowValue(row, "onchainId")}</option>)}
        </select>
      </label> : <p className="muted">No Provider record is indexed for this wallet yet. Register this address to create one.</p>}
    </>}
    {wallet.error ? <p className="action-error" role="alert">{wallet.error}</p> : null}
  </Panel>;
}

function onchainId(row: JsonRecord | undefined): string { return rowValue(row, "onchainId", ""); }
function isHash(value: string): boolean { return value === "" || /^(0x)?[a-fA-F0-9]{64}$/.test(value); }
function metadataValid(uri: string, hash: string): boolean { return uri.length <= 256 && isHash(hash) && (!uri.trim() || Boolean(hash.trim())); }

export function ProviderWorkspace() {
  const wallet = useProviderAccount();
  const [providerId, setProviderId] = useState("");
  const [name, setName] = useState("");
  const [uri, setUri] = useState("");
  const [hash, setHash] = useState("");
  const [review, setReview] = useState(false);
  useEffect(() => { if (!providerId && wallet.providers[0]) setProviderId(onchainId(wallet.providers[0])); }, [wallet.providers, providerId]);
  const provider = wallet.providers.find((row) => onchainId(row) === providerId);
  const valid = name.trim().length > 0 && name.length <= 64 && metadataValid(uri, hash);
  const previousIds = new Set(wallet.providers.map(onchainId));
  return <main className="content-shell dashboard-shell">
    <PageHeader eyebrow="Provider console" title="Put capital behind a promise." description="Register your wallet, create a monitored Service, publish immutable Pact terms, and manage the capital reserved for Coverage." actions={<Link className="button button-quiet" href="/docs/providers">Provider guide →</Link>} />
    <ProviderIdentity wallet={wallet} providerId={providerId} onProviderChange={setProviderId} />
    {wallet.address && !provider ? <Panel title="Register Provider" kicker="First step">
      <p>Your wallet address becomes the Provider owner. The name is public onchain; metadata URI and SHA-256 are optional.</p>
      <div className="form-preview"><label>Provider name<input maxLength={64} value={name} onChange={(event) => { setName(event.target.value); setReview(false); }} /></label><label>Metadata URI (optional)<input maxLength={256} value={uri} onChange={(event) => { setUri(event.target.value); setReview(false); }} placeholder="https://…" /></label><label>Metadata SHA-256 (optional)<input maxLength={66} value={hash} onChange={(event) => { setHash(event.target.value); setReview(false); }} placeholder="64 hex characters" /></label></div>
      {uri.trim() && !hash.trim() ? <p className="review-warning">Add the metadata SHA-256 when you provide a metadata URI.</p> : null}
      {review && valid ? <ActionReview method="register_provider" title="Provider registration" description="Register the connected wallet as the Provider owner. The record is public and cannot be removed." args={[["Provider name", name.trim()], ["Metadata URI", uri.trim() || "Not supplied"], ["Metadata SHA-256", hash.trim() || "Not supplied"]]} transaction={{ args: [name.trim(), uri.trim(), hash.trim().replace(/^0x/i, "")] }} onFinalized={async () => { await waitForIndexed(() => apiGet<JsonRecord[]>("/providers", { search: wallet.address, limit: 100 }), (result) => asRows(result.data).some((row) => !previousIds.has(onchainId(row)) && rowValue(row, "address", "").toLowerCase() === wallet.address.toLowerCase())); wallet.refresh(); }} /> : <button className="button button-dark" disabled={!valid || wallet.chainId !== FAULTPACT_CHAIN_ID} onClick={() => setReview(true)}>Review Provider registration</button>}
    </Panel> : null}
    {provider ? <>
      <Panel title={text(provider.name)} kicker={`Provider #${providerId}`}><p>Use the wallet that owns this record for every write. Contract state remains authoritative; indexed updates appear after the worker syncs.</p><div className="action-grid"><div><strong>Services and Pacts</strong><p>Create a Service, set the SLA terms, then publish the Pact. Published terms are immutable.</p><Link className="text-button" href="/provider/pacts">Open Pact workspace →</Link></div><div><strong>Capital vault</strong><p>Deposit GEN, allocate backing, and request withdrawals only from free capital.</p><Link className="text-button" href="/provider/capital">Manage capital →</Link></div></div><Freshness indexedAt={provider.indexedAt} /></Panel>
      <Panel title="Your Provider activity" kicker="Indexed contract state"><div className="inline-links"><Link className="button button-quiet" href={`/providers/${providerId}`}>Public profile ↗</Link><Link className="button button-quiet" href={`/services?providerId=${providerId}`}>Services ↗</Link><Link className="button button-quiet" href={`/pacts?providerId=${providerId}`}>Pacts ↗</Link></div></Panel>
    </> : null}
  </main>;
}

type PactFields = {
  availability: string; p95: string; errorRate: string; blockLag: string; scope: string;
  minIncident: string; claimWindow: string; minCoverageDuration: string; maxCoverageDuration: string;
  minCoverage: string; maxCoverage: string; premium: string; deductible: string; maxPayout: string;
  termsUri: string; termsHash: string;
};
const EMPTY_TERMS: PactFields = { availability: "99.9", p95: "1000", errorRate: "0.1", blockLag: "5", scope: "global", minIncident: "5m", claimWindow: "30d", minCoverageDuration: "1d", maxCoverageDuration: "90d", minCoverage: "1", maxCoverage: "10", premium: "1", deductible: "0", maxPayout: "100", termsUri: "", termsHash: "" };
const termFields: Array<[keyof PactFields, string, string, number?]> = [
  ["availability", "Availability floor (%)", "99.9; 0 disables this clause", 100], ["p95", "P95 latency ceiling (ms)", "0 disables this clause", 1_000_000], ["errorRate", "Error rate ceiling (%)", "0 disables this clause", 100], ["blockLag", "Maximum block lag", "0 disables this clause"], ["scope", "Region or scope", "Letters, numbers, dot, underscore or hyphen"],
  ["minIncident", "Minimum Incident duration", "For example: 5m, 2h, or 1d"], ["claimWindow", "Claim filing window", "For example: 30d or 720h"], ["minCoverageDuration", "Minimum Coverage duration", "For example: 1d or 12h"], ["maxCoverageDuration", "Maximum Coverage duration", "For example: 90d or 2160h"],
  ["minCoverage", "Minimum Coverage limit (GEN)", "Exact amount, up to 18 decimals"], ["maxCoverage", "Maximum Coverage limit (GEN)", "Exact amount, up to 18 decimals"], ["premium", "Premium rate per year (%)", "For example: 1.25%", 1000], ["deductible", "Deductible (%)", "0 to 100%", 100], ["maxPayout", "Maximum payout (%)", "Above 0 and up to 100%", 100],
  ["termsUri", "Terms document URI (optional)", "If set, include its SHA-256"], ["termsHash", "Terms SHA-256 (optional)", "64 hex characters"],
];

function readTerms(terms: JsonRecord): PactFields {
  const raw = asRecord(terms.raw);
  const pick = (key: string, fallback: string) => text(raw[key], fallback);
  return {
    availability: formatPpmAsPercentage(pick("availability_threshold_ppm", "0")).replace(/%$/, ""),
    p95: pick("p95_latency_ms", "0"),
    errorRate: formatPpmAsPercentage(pick("error_rate_threshold_ppm", "0")).replace(/%$/, ""),
    blockLag: pick("block_lag_threshold", "0"), scope: rowValue(terms, "regionScope", text(raw.region_scope, "global")),
    minIncident: formatDurationInput(pick("min_incident_duration_seconds", "0")), claimWindow: formatDurationInput(pick("claim_window_seconds", "0")),
    minCoverageDuration: formatDurationInput(pick("min_coverage_duration_seconds", "0")), maxCoverageDuration: formatDurationInput(pick("max_coverage_duration_seconds", "0")),
    minCoverage: genDecimal(pick("min_coverage_amount", "0")), maxCoverage: genDecimal(pick("max_coverage_amount", "0")),
    premium: formatBpsAsPercentage(pick("premium_bps_per_year", "0")).replace(/%$/, ""), deductible: formatBpsAsPercentage(pick("deductible_bps", "0")).replace(/%$/, ""), maxPayout: formatBpsAsPercentage(pick("max_payout_bps", "0")).replace(/%$/, ""),
    termsUri: text(raw.terms_uri, ""), termsHash: text(raw.terms_hash, ""),
  };
}

function pactArgs(fields: PactFields): bigint[] | null {
  const availability = parsePpmPercent(fields.availability), p95 = /^\d+$/.test(fields.p95) ? BigInt(fields.p95) : null;
  const error = parsePpmPercent(fields.errorRate), lag = /^\d+$/.test(fields.blockLag) ? BigInt(fields.blockLag) : null;
  const minIncident = parseDurationInput(fields.minIncident), claimWindow = parseDurationInput(fields.claimWindow);
  const minDuration = parseDurationInput(fields.minCoverageDuration), maxDuration = parseDurationInput(fields.maxCoverageDuration);
  const minCoverage = parseGen(fields.minCoverage), maxCoverage = parseGen(fields.maxCoverage);
  const premium = parseBpsPercent(fields.premium), deductible = parseBpsPercent(fields.deductible), maxPayout = parseBpsPercent(fields.maxPayout);
  if ([availability, p95, error, lag, minIncident, claimWindow, minDuration, maxDuration, minCoverage, maxCoverage, premium, deductible, maxPayout].some((value) => value === null)) return null;
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(fields.scope.trim()) || availability! > 1_000_000n || error! > 1_000_000n || p95! > 1_000_000n || lag! > 100_000n || minIncident! < 1n || claimWindow! < 1n || minDuration! < 1n || maxDuration! < minDuration! || minCoverage! < 1n || maxCoverage! < minCoverage! || premium! > 100_000n || deductible! > 10_000n || maxPayout! < 1n || maxPayout! > 10_000n || !metadataValid(fields.termsUri, fields.termsHash)) return null;
  return [availability!, p95!, error!, lag!, minIncident!, claimWindow!, minDuration!, maxDuration!, minCoverage!, maxCoverage!, premium!, deductible!, maxPayout!];
}

export function ProviderPactsWorkspace() {
  const wallet = useProviderAccount();
  const [providerId, setProviderId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [pactId, setPactId] = useState("");
  const [managedPactId, setManagedPactId] = useState("");
  const [mode, setMode] = useState<"create" | "update" | "revision">("create");
  const [serviceType, setServiceType] = useState("API");
  const [serviceName, setServiceName] = useState("");
  const [serviceUri, setServiceUri] = useState("");
  const [serviceHash, setServiceHash] = useState("");
  const [serviceReview, setServiceReview] = useState(false);
  const [fields, setFields] = useState<PactFields>(EMPTY_TERMS);
  const [pactReview, setPactReview] = useState(false);
  const [lifecycleReview, setLifecycleReview] = useState<"publish" | "pause" | "resume" | "retire" | null>(null);
  useEffect(() => { if (!providerId && wallet.providers[0]) setProviderId(onchainId(wallet.providers[0])); }, [wallet.providers, providerId]);
  const servicesState = useApi<JsonRecord[]>("/services", providerId ? { providerId, limit: 100 } : { limit: 1 }, wallet.revision);
  const pactState = useApi<JsonRecord[]>("/pacts", providerId ? { providerId, limit: 100 } : { limit: 1 }, wallet.revision);
  const services = asRows(servicesState.data?.data);
  const pacts = asRows(pactState.data?.data);
  const targetPacts = pacts.filter((row) => mode === "update" ? rowValue(row, "status").toUpperCase() === "DRAFT" : mode === "revision" ? ["ACTIVE", "PAUSED", "RETIRED", "PUBLISHED"].includes(rowValue(row, "status").toUpperCase()) : false);
  const availableServices = services.filter((row) => rowValue(row, "status").toUpperCase() === "ACTIVE");
  const targetService = availableServices.find((row) => onchainId(row) === serviceId) ?? availableServices[0];
  const selectablePacts = mode === "create" ? pacts : targetPacts;
  const selectedPact = selectablePacts.find((row) => onchainId(row) === pactId) ?? selectablePacts[0];
  const detailState = useApi<JsonRecord>(selectedPact ? `/pacts/${onchainId(selectedPact)}` : "/network");
  const details = asRecord(detailState.data?.data);
  const terms = asRecord(details.terms);
  useEffect(() => {
    if (selectedPact && detailState.data && mode !== "create") setFields(readTerms(terms));
  // API detail is stable until selection/mode changes; do not reset inputs while typing.
  }, [pactId, mode, detailState.data]);
  const serviceValid = serviceType.trim().length > 0 && serviceType.length <= 64 && serviceName.trim().length > 0 && serviceName.length <= 64 && metadataValid(serviceUri, serviceHash);
  const parsedTerms = pactArgs(fields);
  const newPactIds = new Set(pacts.map(onchainId));
  const termsArgs = parsedTerms ? [parsedTerms[0], parsedTerms[1], parsedTerms[2], parsedTerms[3], fields.scope.trim().toLowerCase(), ...parsedTerms.slice(4), fields.termsUri.trim(), fields.termsHash.trim().replace(/^0x/i, "")] : [];
  const selectedPactId = onchainId(selectedPact);
  const action = mode === "create" ? "create_pact_draft" : mode === "update" ? "update_pact_draft" : "create_pact_revision";
  const keyArgs = mode === "create" ? [BigInt(onchainId(targetService) || "0")] : [BigInt(selectedPactId || "0")];
  const finalArgs = [...keyArgs, ...termsArgs];
  const candidateDetails = asRows(pactState.data?.data);
  const managedPact = candidateDetails.find((row) => onchainId(row) === managedPactId) ?? candidateDetails[0];
  const managedPactOnchainId = onchainId(managedPact);
  const managedStatus = rowValue(managedPact, "status").toUpperCase();

  return <main className="content-shell dashboard-shell">
    <PageHeader eyebrow="Provider console / Services and Pacts" title="Publish terms you can stand behind." description="Create a Service, draft human-readable SLA terms, review the contract action, then publish. Published Pacts are immutable; use a revision to change a commitment." actions={<Link className="button button-quiet" href="/provider">← Provider overview</Link>} />
    <ProviderIdentity wallet={wallet} providerId={providerId} onProviderChange={setProviderId} />
    {wallet.address && providerId ? <>
      <Panel title="Create Service" kicker={`Provider #${providerId}`}>
        <p>A Service is the monitored system named by your Pacts. Its type and name are public.</p>
        <div className="form-preview"><label>Service type<input maxLength={64} value={serviceType} onChange={(event) => { setServiceType(event.target.value); setServiceReview(false); }} /></label><label>Service name<input maxLength={64} value={serviceName} onChange={(event) => { setServiceName(event.target.value); setServiceReview(false); }} /></label><label>Metadata URI (optional)<input maxLength={256} value={serviceUri} onChange={(event) => { setServiceUri(event.target.value); setServiceReview(false); }} /></label><label>Metadata SHA-256 (optional)<input maxLength={66} value={serviceHash} onChange={(event) => { setServiceHash(event.target.value); setServiceReview(false); }} placeholder="64 hex characters" /></label></div>
        {serviceReview && serviceValid ? <ActionReview method="create_service" title="Service creation" description="Create this Service under the selected Provider. The record is public and has no deletion action." args={[["Provider", `#${providerId}`], ["Type", serviceType.trim()], ["Service", serviceName.trim()], ["Metadata URI", serviceUri.trim() || "Not supplied"], ["Metadata SHA-256", serviceHash.trim() || "Not supplied"]]} transaction={{ args: [BigInt(providerId), serviceType.trim(), serviceName.trim(), serviceUri.trim(), serviceHash.trim().replace(/^0x/i, "")] }} onFinalized={async () => { const oldIds = new Set(services.map(onchainId)); await waitForIndexed(() => apiGet<JsonRecord[]>("/services", { providerId, limit: 100 }), (result) => asRows(result.data).some((row) => !oldIds.has(onchainId(row)) && rowValue(row, "name") === serviceName.trim())); wallet.refresh(); }} /> : <button className="button button-dark" disabled={!serviceValid || wallet.chainId !== FAULTPACT_CHAIN_ID} onClick={() => setServiceReview(true)}>Review Service creation</button>}
      </Panel>
      <Panel title="Service records" kicker={`${services.length} indexed for this Provider`}>{servicesState.loading ? <LoadingState /> : servicesState.error ? <ErrorState message={servicesState.error} retry={wallet.refresh} /> : services.length ? <div className="form-preview"><label>Service for this Pact
        <select value={serviceId || onchainId(targetService)} onChange={(event) => setServiceId(event.target.value)}>{availableServices.map((row) => <option key={onchainId(row)} value={onchainId(row)}>{rowValue(row, "name")} · #{onchainId(row)}</option>)}</select>
      </label><label>Service state<div className="status-line">{rowValue(targetService, "status")}</div></label></div> : <p className="muted">Create a Service before drafting a Pact.</p>}</Panel>
      <Panel title="Pact terms" kicker="Precise terms in human units">
        <div className="form-mode"><label>Action<select value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setPactReview(false); }}><option value="create">Create new draft</option><option value="update" disabled={!targetPacts.length}>Update an unpublished draft</option><option value="revision" disabled={!targetPacts.length}>Create a revision of a published Pact</option></select></label>{mode !== "create" ? <label>{mode === "update" ? "Draft" : "Published Pact"}<select value={pactId || onchainId(targetPacts[0])} onChange={(event) => { setPactId(event.target.value); setPactReview(false); }}><option value="">Choose Pact</option>{targetPacts.map((row) => <option key={onchainId(row)} value={onchainId(row)}>Pact #{onchainId(row)} · {rowValue(row, "status")}</option>)}</select></label> : null}</div>
        {mode === "create" && !availableServices.length ? <p className="review-warning">Create or resume an active Service before drafting a Pact.</p> : null}
        {mode !== "create" && detailState.loading ? <LoadingState label="Loading selected Pact terms" /> : null}
        <div className="form-preview">{termFields.map(([key, label, help, maxLength]) => <label key={key}>{label}<input inputMode={key === "scope" || key.endsWith("Uri") || key.endsWith("Hash") ? "text" : "decimal"} maxLength={maxLength ?? (key === "scope" ? 64 : undefined)} value={fields[key]} onChange={(event) => { setFields({ ...fields, [key]: event.target.value }); setPactReview(false); }} /><small>{help}</small></label>)}</div>
        {!parsedTerms ? <p className="review-warning" role="status">Check each term: thresholds, percentages, durations, amounts, and document hash must meet the listed units and ranges.</p> : null}
        {pactReview && parsedTerms && (mode === "create" ? Boolean(targetService) : Boolean(selectedPact)) ? <ActionReview key={`${action}:${selectedPactId}`} method={action} title={mode === "create" ? "Create Pact draft" : mode === "update" ? "Update Pact draft" : "Create Pact revision"} description={mode === "revision" ? "Create a new draft linked to the selected published Pact. Its terms will be independent and immutable after publishing." : mode === "update" ? "Update this unpublished draft. Published terms can never be edited in place." : "Create a draft attached to the selected Service. It becomes purchasable only after publishing and capital allocation."} args={[["Service", `#${onchainId(targetService)}`], ["Scope", fields.scope.trim().toLowerCase()], ["Availability floor", `${fields.availability}%`], ["P95 ceiling", `${fields.p95} ms`], ["Error rate ceiling", `${fields.errorRate}%`], ["Block lag ceiling", fields.blockLag], ["Minimum Incident", fields.minIncident], ["Claim window", fields.claimWindow], ["Coverage duration", `${fields.minCoverageDuration} to ${fields.maxCoverageDuration}`], ["Coverage limit", `${fields.minCoverage} to ${fields.maxCoverage} GEN`], ["Premium per year", `${fields.premium}%`], ["Deductible", `${fields.deductible}%`], ["Maximum payout", `${fields.maxPayout}%`], ["Terms URI", fields.termsUri || "Not supplied"]]} transaction={{ args: finalArgs }} onFinalized={async () => {
          if (mode === "update") await waitForIndexed(() => apiGet<JsonRecord>(`/pacts/${selectedPactId}`), (result) => rowValue(asRecord(asRecord(result.data).terms), "regionScope").toLowerCase() === fields.scope.trim().toLowerCase() && Date.parse(rowValue(asRecord(asRecord(result.data).terms), "indexedAt", "")) > 0);
          else {
            const result = await waitForIndexed(() => apiGet<JsonRecord[]>("/pacts", { providerId, limit: 100 }), (current) => asRows(current.data).some((row) => !newPactIds.has(onchainId(row)) && rowValue(row, "status").toUpperCase() === "DRAFT"));
            const created = asRows(result.data).find((row) => !newPactIds.has(onchainId(row)) && rowValue(row, "status").toUpperCase() === "DRAFT");
            if (created) setManagedPactId(onchainId(created));
          }
          wallet.refresh();
        }} /> : <button className="button button-dark" disabled={!parsedTerms || wallet.chainId !== FAULTPACT_CHAIN_ID || (mode === "create" ? !targetService : !selectedPact)} onClick={() => setPactReview(true)}>Review Pact terms</button>}
      </Panel>
      <Panel title="Publish and manage Pacts" kicker="Published terms are immutable">
        {pactState.loading ? <LoadingState /> : pactState.error ? <ErrorState message={pactState.error} retry={wallet.refresh} /> : candidateDetails.length ? <label className="form-select">Pact<select value={managedPactId || onchainId(candidateDetails[0])} onChange={(event) => { setManagedPactId(event.target.value); setLifecycleReview(null); }}><option value="">Choose Pact</option>{candidateDetails.map((row) => <option key={onchainId(row)} value={onchainId(row)}>Pact #{onchainId(row)} · {rowValue(row, "status")}</option>)}</select></label> : <p className="muted">Draft and index a Pact to publish it here.</p>}
        {managedPact ? <><div className="kv-grid compact"><KeyValue label="Selected Pact" value={`#${managedPactOnchainId}`} /><KeyValue label="State" value={managedStatus} /><KeyValue label="Revision" value={rowValue(managedPact, "revision")} /></div><p className="muted">{managedStatus === "DRAFT" ? "Publishing freezes these terms. To change them later, create a new revision." : "Sales controls affect new Coverage only. Existing Coverages retain their Pact terms."}</p>
          {managedStatus === "DRAFT" ? <button className="button button-coral" onClick={() => setLifecycleReview("publish")}>Review and publish Pact</button> : null}
          {managedStatus === "ACTIVE" || managedStatus === "PUBLISHED" ? <button className="button button-quiet" onClick={() => setLifecycleReview("pause")}>Pause new Coverage sales</button> : null}
          {managedStatus === "PAUSED" ? <button className="button button-quiet" onClick={() => setLifecycleReview("resume")}>Resume Coverage sales</button> : null}
          {["ACTIVE", "PUBLISHED", "PAUSED"].includes(managedStatus) ? <button className="button button-quiet" onClick={() => setLifecycleReview("retire")}>Retire Pact</button> : null}
          {lifecycleReview ? <ActionReview key={`${lifecycleReview}:${managedPactOnchainId}`} method={lifecycleReview === "publish" ? "publish_pact" : lifecycleReview === "pause" ? "pause_pact_sales" : lifecycleReview === "resume" ? "resume_pact_sales" : "retire_pact"} title={lifecycleReview === "publish" ? "Publish Pact" : lifecycleReview === "pause" ? "Pause new sales" : lifecycleReview === "resume" ? "Resume new sales" : "Retire Pact"} description={lifecycleReview === "publish" ? "Publishing freezes these terms and makes the Pact eligible for sales when capital is allocated." : lifecycleReview === "retire" ? "Retirement is irreversible. It stops future sales; it does not change existing Coverage." : "This changes sales availability only; it does not alter published terms or active Coverage."} args={[["Pact", `#${managedPactOnchainId}`], ["Current state", managedStatus], ["Result", lifecycleReview === "publish" || lifecycleReview === "resume" ? "Available for sales after capacity checks" : lifecycleReview === "pause" ? "New sales paused" : "Pact retired"]]} transaction={{ args: [BigInt(managedPactOnchainId)] }} onFinalized={async () => { const next = lifecycleReview === "publish" || lifecycleReview === "resume" ? ["ACTIVE", "PUBLISHED"] : lifecycleReview === "pause" ? ["PAUSED"] : ["RETIRED"]; await waitForIndexed(() => apiGet<JsonRecord>(`/pacts/${managedPactOnchainId}`), (result) => next.includes(rowValue(asRecord(result.data), "status").toUpperCase())); wallet.refresh(); }} /> : null}
        </> : null}
      </Panel>
    </> : null}
  </main>;
}

function amount(value: unknown): bigint { const raw = text(value, "0"); return /^\d+$/.test(raw) ? BigInt(raw) : 0n; }

export function ProviderCapitalWorkspace() {
  const wallet = useProviderAccount();
  const [providerId, setProviderId] = useState("");
  const [pactId, setPactId] = useState("");
  const [deposit, setDeposit] = useState("");
  const [allocate, setAllocate] = useState("");
  const [deallocate, setDeallocate] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [action, setAction] = useState<"deposit" | "allocate" | "deallocate" | "request" | "cancel" | "execute" | null>(null);
  const provider = wallet.providers.find((row) => onchainId(row) === providerId) ?? wallet.providers[0];
  useEffect(() => { if (provider && !providerId) setProviderId(onchainId(provider)); }, [provider, providerId]);
  const providerState = useApi<JsonRecord>(providerId ? `/providers/${providerId}` : "/network", undefined, wallet.revision);
  const providerDetails = asRecord(providerState.data?.data);
  const vault = asRecord(providerDetails.vault);
  const rawVault = asRecord(vault.raw);
  const total = amount(vault.totalCapital), allocated = amount(vault.allocated), reserved = amount(vault.reserved), pending = amount(vault.pending);
  const free = total > allocated + pending ? total - allocated - pending : 0n;
  const unlockAt = amount(rawVault.withdrawal_unlock_ts);
  const pactState = useApi<JsonRecord[]>("/pacts", providerId ? { providerId, limit: 100 } : { limit: 1 }, wallet.revision);
  const pacts = asRows(pactState.data?.data);
  const activePacts = pacts.filter((row) => ["ACTIVE", "PUBLISHED"].includes(rowValue(row, "status").toUpperCase()));
  const selectedPact = activePacts.find((row) => onchainId(row) === pactId) ?? activePacts[0];
  const selectedPactId = onchainId(selectedPact);
  const capacity = useApi<JsonRecord>(selectedPact ? `/pacts/${selectedPactId}/capacity` : "/network");
  const capacityState = asRecord(capacity.data?.data);
  const pactAllocated = amount(capacityState.totalAllocated);
  const pactReserved = amount(capacityState.totalReserved);
  const pactFree = pactAllocated > pactReserved ? pactAllocated - pactReserved : 0n;
  const depositValue = parseGen(deposit), allocateValue = parseGen(allocate), deallocateValue = parseGen(deallocate), withdrawValue = parseGen(withdraw);
  const pendingAllowed = pending === 0n;

  function clearAction() { setAction(null); }
  function renderAction() {
    if (!action || !providerId) return null;
    const previousTotal = total, previousAllocated = allocated, previousPending = pending, previousFree = free;
    const expectedPactAllocated = pactAllocated, expectedPactReserved = pactReserved;
    const transaction = action === "deposit" && depositValue && depositValue > 0n ? { method: "deposit_capital", args: [BigInt(providerId)], value: depositValue, review: [["Provider", `#${providerId}`], ["GEN to deposit", formatGen(depositValue)], ["Wallet payment", formatGen(depositValue)]], description: "Deposit GEN into this Provider vault. It becomes free capital; it is not allocated to any Pact yet." }
      : action === "allocate" && allocateValue && allocateValue > 0n && selectedPact ? { method: "allocate_capital", args: [BigInt(selectedPactId), allocateValue], value: 0n, review: [["Pact", `#${selectedPactId}`], ["Capital to allocate", formatGen(allocateValue)], ["Free capital after", formatGen(previousFree - allocateValue)]], description: "Allocate free Provider capital to this published Pact so it can support Coverage sales." }
      : action === "deallocate" && deallocateValue && deallocateValue > 0n && selectedPact ? { method: "deallocate_capital", args: [BigInt(selectedPactId), deallocateValue], value: 0n, review: [["Pact", `#${selectedPactId}`], ["Available allocation", formatGen(pactFree)], ["Capital to deallocate", formatGen(deallocateValue)]], description: "Only capital not reserved for Coverage or Claims can be deallocated." }
      : action === "request" && withdrawValue && withdrawValue > 0n ? { method: "request_capital_withdrawal", args: [BigInt(providerId), withdrawValue], value: 0n, review: [["Provider", `#${providerId}`], ["Free capital", formatGen(previousFree)], ["Withdrawal requested", formatGen(withdrawValue)], ["Cooldown", "Contract-set withdrawal delay"]], description: "Request a withdrawal from free capital. Execution is a separate action after the cooldown; reserved capital cannot be requested." }
      : action === "cancel" && pending > 0n ? { method: "cancel_capital_withdrawal", args: [BigInt(providerId)], value: 0n, review: [["Pending withdrawal", formatGen(pending)], ["Result", "Request cancelled; capital remains in the vault"]], description: "Cancel the pending withdrawal. This does not remove capital from the vault." }
      : action === "execute" && pending > 0n && unlockAt > 0n && unlockAt <= BigInt(Math.floor(Date.now() / 1000)) ? { method: "execute_capital_withdrawal", args: [BigInt(providerId)], value: 0n, review: [["Pending withdrawal", formatGen(pending)], ["Unlock time", formatUnixSeconds(String(unlockAt))], ["Result", "Moves the amount into internal FaultPact credit"]], description: "Execute the eligible request. The contract moves the amount to internal FaultPact credit; it does not itself confirm an external GEN receipt." }
      : null;
    if (!transaction) return <p className="review-warning" role="status">{action === "execute" ? pending === 0n ? "There is no pending withdrawal." : unlockAt === 0n || unlockAt > BigInt(Math.floor(Date.now() / 1000)) ? `Withdrawal cooldown active until ${formatUnixSeconds(String(unlockAt))}.` : "The request cannot execute from this vault state." : action === "cancel" ? "There is no pending withdrawal to cancel." : action === "allocate" && !selectedPact ? "Publish and index a Pact before allocating capital." : action === "deallocate" && selectedPact && pactFree === 0n ? "All allocated capital is reserved for active Coverage or Claims." : action === "request" && previousFree === 0n ? "There is not enough free capital; allocated and pending amounts are unavailable." : "Enter a valid GEN amount within the free or available balance."}</p>;
    return <ActionReview key={`${transaction.method}:${selectedPactId}:${transaction.args[1] ?? transaction.value}`} method={transaction.method} title={transaction.method.replaceAll("_", " ")} description={transaction.description} args={transaction.review as Array<[string, string]>} transaction={{ args: transaction.args, value: transaction.value }} onFinalized={async () => {
      if (action === "deposit" && depositValue) await waitForIndexed(() => apiGet<JsonRecord>(`/providers/${providerId}`), (result) => amount(asRecord(asRecord(result.data).vault).totalCapital) >= previousTotal + depositValue);
      if (action === "allocate" && allocateValue) await waitForIndexed(() => apiGet<JsonRecord>(`/pacts/${selectedPactId}/capacity`), (result) => amount(asRecord(result.data).totalAllocated) >= expectedPactAllocated + allocateValue);
      if (action === "deallocate" && deallocateValue) await waitForIndexed(() => apiGet<JsonRecord>(`/pacts/${selectedPactId}/capacity`), (result) => amount(asRecord(result.data).totalAllocated) <= expectedPactAllocated - deallocateValue && amount(asRecord(result.data).totalReserved) === expectedPactReserved);
      if (action === "request" && withdrawValue) await waitForIndexed(() => apiGet<JsonRecord>(`/providers/${providerId}`), (result) => amount(asRecord(asRecord(result.data).vault).pending) === withdrawValue);
      if (action === "cancel") await waitForIndexed(() => apiGet<JsonRecord>(`/providers/${providerId}`), (result) => amount(asRecord(asRecord(result.data).vault).pending) === 0n);
      if (action === "execute") await waitForIndexed(() => apiGet<JsonRecord>(`/providers/${providerId}`), (result) => amount(asRecord(asRecord(result.data).vault).pending) === 0n && amount(asRecord(asRecord(result.data).vault).totalCapital) < previousTotal);
      wallet.refresh();
    }} />;
  }

  return <main className="content-shell dashboard-shell">
    <PageHeader eyebrow="Provider console / Capital" title="Know what is free before you move it." description="Reserved capital backs active Coverage and Claims. Requests use free capital, wait through the contract cooldown, then move to internal FaultPact credit." actions={<Link className="button button-quiet" href="/provider">← Provider overview</Link>} />
    <ProviderIdentity wallet={wallet} providerId={providerId} onProviderChange={setProviderId} />
    {wallet.address && providerId ? <>
      {providerState.loading ? <LoadingState /> : providerState.error ? <ErrorState message={providerState.error} retry={wallet.refresh} /> : <Panel title="Provider vault" kicker={`Provider #${providerId}`} action={<button className="button button-quiet" onClick={wallet.refresh}>Refresh indexed state</button>}><div className="term-grid capacity-grid"><Metric label="Total capital" value={formatGen(total.toString())} compactValue /><Metric label="Allocated" value={formatGen(allocated.toString())} compactValue /><Metric label="Reserved" value={formatGen(reserved.toString())} tone="accent" compactValue /><Metric label="Free" value={formatGen(free.toString())} detail="after allocation and pending withdrawal" compactValue /><Metric label="Pending withdrawal" value={formatGen(pending.toString())} compactValue /><Metric label="Unlock time" value={unlockAt > 0n ? formatUnixSeconds(String(unlockAt)) : "None pending"} compactValue /></div><p className="muted">Free = total − allocated − pending. Reserved is part of allocated capital and cannot be deallocated while Coverage or Claims need it.</p>{pending > 0n && unlockAt > BigInt(Math.floor(Date.now() / 1000)) ? <p className="review-warning" role="status">Withdrawal cooldown is active until {formatUnixSeconds(String(unlockAt))}.</p> : null}<Freshness indexedAt={vault.indexedAt ?? providerDetails.indexedAt} /></Panel>}
      <Panel title="Deposit GEN" kicker="Add to Provider total"><label>Amount (GEN)<input inputMode="decimal" value={deposit} onChange={(event) => { setDeposit(event.target.value.replace(/[^0-9.]/g, "")); clearAction(); }} placeholder="0.5" /></label><button className="button button-dark" disabled={!depositValue || depositValue <= 0n || wallet.chainId !== FAULTPACT_CHAIN_ID} onClick={() => setAction("deposit")}>Review deposit</button>{action === "deposit" ? renderAction() : null}</Panel>
      <Panel title="Allocate or deallocate" kicker="Back published Pacts">
        {pactState.loading ? <LoadingState /> : pactState.error ? <ErrorState message={pactState.error} retry={wallet.refresh} /> : activePacts.length ? <label className="form-select">Published Pact<select value={selectedPactId} onChange={(event) => { setPactId(event.target.value); clearAction(); }}>{activePacts.map((row) => <option key={onchainId(row)} value={onchainId(row)}>Pact #{onchainId(row)} · {rowValue(row, "status")}</option>)}</select></label> : <p className="muted">No published Pact is available to allocate.</p>}
        {selectedPact ? <><div className="kv-grid compact"><KeyValue label="Pact allocation" value={formatGen(pactAllocated.toString())} /><KeyValue label="Reserved" value={formatGen(pactReserved.toString())} /><KeyValue label="Can deallocate" value={formatGen(pactFree.toString())} /></div><div className="form-preview"><label>Allocate (GEN)<input inputMode="decimal" value={allocate} onChange={(event) => { setAllocate(event.target.value.replace(/[^0-9.]/g, "")); clearAction(); }} placeholder="1" /><small>Free Provider capital: {formatGen(free.toString())}</small></label><label>Deallocate unreserved (GEN)<input inputMode="decimal" value={deallocate} onChange={(event) => { setDeallocate(event.target.value.replace(/[^0-9.]/g, "")); clearAction(); }} placeholder="1" /><small>Unreserved allocation: {formatGen(pactFree.toString())}</small></label></div><button className="button button-dark" disabled={!allocateValue || allocateValue <= 0n || allocateValue > free || wallet.chainId !== FAULTPACT_CHAIN_ID} onClick={() => setAction("allocate")}>Review allocation</button><button className="button button-quiet" disabled={!deallocateValue || deallocateValue <= 0n || deallocateValue > pactFree || wallet.chainId !== FAULTPACT_CHAIN_ID} onClick={() => setAction("deallocate")}>Review deallocation</button>{action === "allocate" || action === "deallocate" ? renderAction() : null}</> : null}
      </Panel>
      <Panel title="Request or complete withdrawal" kicker="Reserved amounts stay in the vault"><div className="form-preview"><label>Request from free capital (GEN)<input inputMode="decimal" value={withdraw} onChange={(event) => { setWithdraw(event.target.value.replace(/[^0-9.]/g, "")); clearAction(); }} placeholder="1" /><small>Available now: {formatGen(free.toString())}. A pending request blocks another.</small></label><div className="capital-controls"><button className="button button-dark" disabled={!withdrawValue || withdrawValue <= 0n || withdrawValue > free || !pendingAllowed || wallet.chainId !== FAULTPACT_CHAIN_ID} title={!pendingAllowed ? "Cancel or execute the pending withdrawal first." : free === 0n ? "Reserved and allocated funds are unavailable." : undefined} onClick={() => setAction("request")}>Request withdrawal</button><button className="button button-quiet" disabled={pending === 0n || wallet.chainId !== FAULTPACT_CHAIN_ID} onClick={() => setAction("cancel")}>Cancel pending request</button><button className="button button-quiet" disabled={pending === 0n || unlockAt === 0n || unlockAt > BigInt(Math.floor(Date.now() / 1000)) || wallet.chainId !== FAULTPACT_CHAIN_ID} title={pending > 0n && unlockAt > BigInt(Math.floor(Date.now() / 1000)) ? "Withdrawal cooldown is active." : undefined} onClick={() => setAction("execute")}>Execute unlocked request</button></div></div><p className="muted">Executing a withdrawal credits your FaultPact account. Use the separate Customer credit action to request external GEN; the accepted F-06 limitation means internal credit debit alone does not prove receipt.</p>{action === "request" || action === "cancel" || action === "execute" ? renderAction() : null}</Panel>
    </> : null}
  </main>;
}
