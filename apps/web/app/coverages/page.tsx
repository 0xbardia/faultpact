import { Shell } from "../../components/shell";
import { ResourceList } from "../../components/explorer";
import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata("Coverages", "Review active and historical Coverage positions backed by published Pacts.", "/coverages");
export default function CoveragesPage() { return <Shell><ResourceList resource="coverages" /></Shell>; }
