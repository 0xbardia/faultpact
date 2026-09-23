import Link from "next/link";
import { Shell } from "../../../components/shell";
import { PageHeader, Panel } from "../../../components/ui";

export default function ProviderPactsPage() {
  return <Shell><main className="content-shell"><PageHeader eyebrow="Provider console / Pacts" title="Review published commitments." description="This page is read-only. Provider registration, Pact drafting, and publishing are not available in the web console yet." actions={<Link className="button button-quiet" href="/provider">← Provider overview</Link>} /><Panel title="Published Pact records" kicker="Read-only indexed state"><p>Explore existing Pacts to compare frozen SLA terms, Provider backing, and current Coverage capacity. Published terms cannot be edited in place.</p><Link className="text-link" href="/pacts">Browse indexed Pacts →</Link></Panel><Panel title="Provider publishing" kicker="Not available in this console"><p>Connect a Provider account and create a service before drafting and publishing a Pact. Those write workflows are not implemented here.</p><Link className="text-link" href="/docs/providers">Read the Provider guide →</Link></Panel></main></Shell>;
}
