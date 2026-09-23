import { pageMetadata } from "../../../lib/metadata";
import { Shell } from "../../../components/shell";
import { CoverageDetail } from "../../../components/explorer";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return pageMetadata(`Coverage #${id}`, `Review Coverage #${id}, its Pact terms, deadlines, and contract-backed state.`, `/coverages/${id}`); }
export default async function CoverageDetailPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><CoverageDetail id={(await params).id} /></Shell>; }
