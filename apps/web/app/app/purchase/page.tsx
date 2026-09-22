import { Shell } from "../../../components/shell";
import { PurchaseFlow } from "../../../components/purchase";

export default async function PurchasePage({ searchParams }: { searchParams: Promise<{ pact?: string }> }) { return <Shell><PurchaseFlow selected={(await searchParams).pact ?? ""} /></Shell>; }
