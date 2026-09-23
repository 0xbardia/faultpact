import { pageMetadata } from "../../../lib/metadata";
import { Shell } from "../../../components/shell";
import { ProviderDetail } from "../../../components/explorer";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return pageMetadata(`Provider #${id}`, `Inspect Provider #${id}, including bonded capital, published Pacts, and reliability history.`, `/providers/${id}`); }
export default async function ProviderDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><ProviderDetail id={(await params).id} /></Shell>; }
