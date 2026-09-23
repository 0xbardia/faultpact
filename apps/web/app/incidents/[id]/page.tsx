import { pageMetadata } from "../../../lib/metadata";
import { Shell } from "../../../components/shell";
import { IncidentDetail } from "../../../components/explorer";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return pageMetadata(`Incident #${id}`, `Inspect Incident #${id}, its evidence provenance, canonical facts, and challenge state.`, `/incidents/${id}`); }
export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><IncidentDetail id={(await params).id} /></Shell>; }
