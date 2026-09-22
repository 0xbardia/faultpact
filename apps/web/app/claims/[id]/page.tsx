import { Shell } from "../../../components/shell";
import { ClaimDetail } from "../../../components/explorer";
export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><ClaimDetail id={(await params).id} /></Shell>; }
