import { pageMetadata } from "../../../lib/metadata";
import { Shell } from "../../../components/shell";
import { ServiceDetail } from "../../../components/explorer";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return pageMetadata(`Service #${id}`, `Review monitoring signals, Pacts, and Incident history for Service #${id}.`, `/services/${id}`); }
export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><ServiceDetail id={(await params).id} /></Shell>; }
