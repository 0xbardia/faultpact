import { Shell } from "../../components/shell";
import { ResourceList } from "../../components/explorer";
import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata("Claims", "Track claims against Coverage and Incidents through contract-backed settlement.", "/claims");
export default function ClaimsPage() { return <Shell><ResourceList resource="claims" /></Shell>; }
