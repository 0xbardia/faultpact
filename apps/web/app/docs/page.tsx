import Link from "next/link";
import { Shell } from "../../components/shell";
import { DocsLayout } from "../../components/docs";

export default function DocsPage() {
  return <Shell><DocsLayout slug=""><div className="docs-index"><p className="eyebrow">FaultPact documentation</p><h1>Make the protocol legible.</h1><p className="lede">A reliability exchange for Providers, Customers, and the people integrating both sides.</p><div className="doc-paths"><Link href="/docs/providers"><strong>I am a Provider</strong><span>Capital, Services, Pacts →</span></Link><Link href="/docs/customers"><strong>I am a Customer</strong><span>Coverage, Incidents, Claims →</span></Link><Link href="/docs/api"><strong>I am integrating FaultPact</strong><span>API, contract, evidence →</span></Link></div><div className="docs-index-grid"><section><p className="footer-label">Protocol</p><Link href="/docs/protocol">How FaultPact works →</Link><Link href="/docs/evidence">Evidence model →</Link><Link href="/docs/resolution">Resolution →</Link><Link href="/docs/security">Security boundaries →</Link></section><section><p className="footer-label">Operations</p><Link href="/docs/monitoring">Monitoring →</Link><Link href="/docs/network">Network →</Link><Link href="/docs/contract">Frozen contract →</Link></section></div></div></DocsLayout></Shell>;
}
