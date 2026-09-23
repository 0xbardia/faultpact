import { Shell } from "../../components/shell";
import { ResourceList } from "../../components/explorer";
import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata("Services", "Browse monitored Services and their published reliability commitments.", "/services");
export default function ServicesPage() { return <Shell><ResourceList resource="services" /></Shell>; }
