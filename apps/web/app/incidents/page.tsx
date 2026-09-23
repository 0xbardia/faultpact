import { Shell } from "../../components/shell";
import { ResourceList } from "../../components/explorer";
import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata("Incidents", "Inspect Incident evidence, canonical facts, challenges, and claim evaluation.", "/incidents");
export default function IncidentsPage() { return <Shell><ResourceList resource="incidents" /></Shell>; }
