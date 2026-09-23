import { Shell } from "../../components/shell";
import { MonitoringOverview } from "../../components/explorer";
import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata("Monitoring", "View current RPC monitoring signals and regional service health.", "/monitoring");
export default function MonitoringPage() { return <Shell><MonitoringOverview /></Shell>; }
