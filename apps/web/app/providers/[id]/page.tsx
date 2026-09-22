import { Shell } from "../../../components/shell";
import { ProviderDetail } from "../../../components/explorer";
export default async function ProviderDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><ProviderDetail id={(await params).id} /></Shell>; }
