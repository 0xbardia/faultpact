import { Shell } from "../../components/shell";
import { ResourceList } from "../../components/explorer";
import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata("Pacts", "Compare frozen SLA terms, Provider backing, Coverage limits, and claim windows.", "/pacts");
export default function PactsPage() { return <Shell><ResourceList resource="pacts" /></Shell>; }
