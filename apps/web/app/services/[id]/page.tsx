import { Shell } from "../../../components/shell";
import { ServiceDetail } from "../../../components/explorer";
export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><ServiceDetail id={(await params).id} /></Shell>; }
