"use client";

import { Shell } from "../../components/shell";
import { asRecord } from "../../lib/api";
import { useApi } from "../../lib/use-api";
import { ErrorState, Freshness, LoadingState, PageHeader, Panel, StatusBadge } from "../../components/ui";

export default function StatusPage() {
  const state = useApi<Record<string, unknown>>("/status");
  const data = asRecord(state.data?.data);
  const latestUpdate = [
    ...(Array.isArray(data.heartbeats) ? data.heartbeats.map((item) => asRecord(item).updatedAt) : []),
    ...(Array.isArray(data.cursors) ? data.cursors.map((item) => asRecord(item).lastSuccessAt) : []),
  ].filter((value): value is string => typeof value === "string").sort().at(-1);
  return <Shell><main className="content-shell"><PageHeader eyebrow="Protocol operations" title="Status" description="Worker heartbeats and indexer cursors for the Studio Dev deployment." />{state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} /> : <div className="status-grid"><Panel title="Workers" kicker="Operational heartbeat"><div className="status-list">{Array.isArray(data.heartbeats) && data.heartbeats.length ? data.heartbeats.map((item) => { const row = asRecord(item); return <div className="status-list-row" key={String(row.workerId)}><span><b>{String(row.workerId)}</b><small>{String(row.region ?? "—")} · {String(row.mode ?? "—")}</small></span><StatusBadge value={row.status} /></div>; }) : <span className="muted">No worker heartbeat indexed.</span>}</div></Panel><Panel title="Indexer cursors" kicker="Contract wins"><div className="status-list">{Array.isArray(data.cursors) && data.cursors.length ? data.cursors.map((item) => { const row = asRecord(item); return <div className="status-list-row" key={String(row.entityKind)}><span><b>{String(row.entityKind)}</b><small>{String(row.lastError ?? "No error")}</small></span><StatusBadge value={row.status} /></div>; }) : <span className="muted">No cursor data indexed.</span>}</div><Freshness indexedAt={latestUpdate ?? null} source="Latest worker or indexer update" /></Panel></div>}</main></Shell>;
}
