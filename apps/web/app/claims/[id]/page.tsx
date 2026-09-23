import { pageMetadata } from "../../../lib/metadata";
import { Shell } from "../../../components/shell";
import { ClaimDetail } from "../../../components/explorer";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return pageMetadata(`Claim #${id}`, `Track Claim #${id} and review its Coverage, Incident, and contract-backed payout.`, `/claims/${id}`); }
export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><ClaimDetail id={(await params).id} /></Shell>; }
