import Link from "next/link";
import { Shell } from "../../../components/shell";
import { PactDetail } from "../../../components/explorer";
export default async function PactDetailPage({ params }: { params: Promise<{ id: string }> }) { const id = (await params).id; return <Shell><PactDetail id={id} /><div className="floating-action"><Link className="button button-coral" href={`/app/purchase?pact=${id}`}>Review Coverage for this Pact ↗</Link></div></Shell>; }
