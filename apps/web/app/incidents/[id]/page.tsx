import { Shell } from "../../../components/shell";
import { IncidentDetail } from "../../../components/explorer";
export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><IncidentDetail id={(await params).id} /></Shell>; }
