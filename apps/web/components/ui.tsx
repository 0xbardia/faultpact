import Link from "next/link";
import type { ReactNode } from "react";
import { formatAddress, formatDate, formatHash, relativeTime, rowValue, statusLabel, statusTone } from "../lib/format";
import type { JsonRecord } from "../lib/api";

export function ProductGlyph({ kind, size = 28 }: { kind: "pact" | "bond" | "service" | "coverage" | "incident" | "evidence" | "resolution" | "settlement"; size?: number }) {
  const paths: Record<string, ReactNode> = {
    pact: <><path d="M7 4h10l4 4v12H7z" /><path d="M17 4v5h5M10 13h8M10 17h5" /></>,
    bond: <><path d="M12 3 20 7v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="m8 13 3 3 6-7" /></>,
    service: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h4M8 17h6" /></>,
    coverage: <><path d="M4 8h16v11H4z" /><path d="M8 8V5h8v3M8 13h8M12 10v6" /></>,
    incident: <><path d="m12 3 9 17H3z" /><path d="M12 9v5M12 17v.1" /></>,
    evidence: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    resolution: <><circle cx="12" cy="12" r="8" /><path d="m8 12 3 3 5-6" /></>,
    settlement: <><path d="M4 9h16v10H4zM6 9V6h12v3M8 14h8" /><path d="M12 12v5" /></>,
  };
  return <svg aria-hidden="true" className="glyph" width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
}

export function StatusBadge({ value, label }: { value: unknown; label?: string }) {
  return <span className={`status status-${statusTone(value)}`}><span className="status-dot" />{label ?? statusLabel(value)}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div><p className="eyebrow">{eyebrow ?? "FaultPact explorer"}</p><h1>{title}</h1>{description ? <p className="lede">{description}</p> : null}</div>
    {actions ? <div className="page-actions">{actions}</div> : null}
  </header>;
}

export function Metric({ label, value, detail, tone = "default", compactValue = false }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "default" | "accent" | "dark"; compactValue?: boolean }) {
  return <div className={`metric metric-${tone}${compactValue ? " metric-compact" : ""}`}><span className="metric-label">{label}</span><strong>{value}</strong>{detail ? <span className="metric-detail">{detail}</span> : null}</div>;
}

export function Panel({ children, className = "", title, kicker, action }: { children: ReactNode; className?: string; title?: string; kicker?: string; action?: ReactNode }) {
  return <section className={`panel ${className}`}>
    {(title || kicker || action) ? <div className="panel-head"> <div>{kicker ? <p className="eyebrow">{kicker}</p> : null}{title ? <h2>{title}</h2> : null}</div>{action}</div> : null}
    {children}
  </section>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark">∅</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function LoadingState({ label = "Loading indexed state" }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="loader" />{label}</div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><strong>Data unavailable</strong><span>{message}</span>{retry ? <button className="text-button" onClick={retry}>Try again</button> : null}</div>;
}

export function Freshness({ indexedAt, source = "Indexed contract state" }: { indexedAt?: unknown; source?: string }) {
  return <div className="freshness"><span className="freshness-mark" />{source} · {relativeTime(indexedAt)}</div>;
}

export function CopyValue({ value, display, label = "Copy value" }: { value: string; display?: string; label?: string }) {
  return <button className="copy-value" aria-label={label} title={label} onClick={() => void navigator.clipboard?.writeText(value)}><span className="mono">{display ?? value}</span><span aria-hidden="true">⧉</span></button>;
}

export function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div className="key-value"><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>;
}

export type Column = { label: string; key: string; format?: (value: unknown, row: JsonRecord) => ReactNode };

export function DataTable({ rows, columns, href }: { rows: JsonRecord[]; columns: Column[]; href?: (row: JsonRecord) => string }) {
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.onchainId ?? row.id ?? index}`}>
    {columns.map((column) => <td key={column.key}>{href && column === columns[0] ? <Link className="table-link" href={href(row)}>{column.format ? column.format(row[column.key], row) : rowValue(row, column.key)}</Link> : column.format ? column.format(row[column.key], row) : rowValue(row, column.key)}</td>)}
  </tr>)}</tbody></table></div>;
}

export function DetailMeta({ row }: { row: JsonRecord }) {
  return <div className="detail-meta"><span>ID <b className="mono">{rowValue(row, "onchainId", rowValue(row, "id"))}</b></span>{row.address ? <span>Address <b className="mono">{formatAddress(row.address)}</b></span> : null}{row.indexedAt ? <span>Indexed {formatDate(row.indexedAt)}</span> : null}</div>;
}

export function EvidenceBadge({ authoritative, excluded = false, supporting = false }: { authoritative: boolean; excluded?: boolean; supporting?: boolean }) {
  const provenance = authoritative ? "AUTHORITATIVE" : "SUPPLEMENTAL";
  if (excluded) return <span className="evidence-badge evidence-review">{provenance} · EXCLUDED</span>;
  if (supporting) return <span className="evidence-badge evidence-authoritative">{provenance} · SUPPORTING</span>;
  return <span className={`evidence-badge ${authoritative ? "evidence-review" : "evidence-supplemental"}`}>{provenance} · CHECKS NOT RUN</span>;
}

export function HashValue({ value }: { value: unknown }) {
  const full = rowValue({ value }, "value", "");
  return full ? <CopyValue value={full} display={formatHash(full)} label="Copy SHA-256" /> : <span>—</span>;
}
