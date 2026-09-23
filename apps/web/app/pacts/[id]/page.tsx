import { pageMetadata } from "../../../lib/metadata";
import { Shell } from "../../../components/shell";
import { PactDetail } from "../../../components/explorer";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return pageMetadata(`Pact #${id}`, `Review Pact #${id}, including Provider backing, SLA thresholds, Coverage bounds, and claim deadlines.`, `/pacts/${id}`); }
export default async function PactDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><PactDetail id={(await params).id} /></Shell>; }
