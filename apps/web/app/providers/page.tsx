import { Shell } from "../../components/shell";
import { ResourceList } from "../../components/explorer";
import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata("Providers", "Browse Provider profiles, bonded capital, published Pacts, and reliability history.", "/providers");
export default function ProvidersPage() { return <Shell><ResourceList resource="providers" /></Shell>; }
