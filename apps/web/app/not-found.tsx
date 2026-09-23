import Link from "next/link";
import type { Metadata } from "next";
import { Shell } from "../components/shell";
import { PageHeader } from "../components/ui";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: true } };

export default function NotFound() {
  return <Shell><main className="content-shell"><PageHeader eyebrow="404 / Not found" title="This page is not in the exchange." description="The record may have moved, or the address may be incomplete. Browse public protocol data or return to the homepage." actions={<><Link className="button button-coral" href="/explore">Explore FaultPact</Link><Link className="button button-quiet" href="/">Home</Link></>} /></main></Shell>;
}
