import { Shell } from "../../../../components/shell";
import { ClaimReview } from "../../../../components/purchase";

export default async function ClaimReviewPage({ params }: { params: Promise<{ id: string }> }) { return <Shell><ClaimReview id={(await params).id} /></Shell>; }
