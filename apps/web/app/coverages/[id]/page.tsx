import { Shell } from "../../../components/shell";
import { CoverageDetail } from "../../../components/explorer";
export default async function CoverageDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><CoverageDetail id={(await params).id} /></Shell>; }
