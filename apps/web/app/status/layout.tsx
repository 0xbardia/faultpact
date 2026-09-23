import type { Metadata } from "next";

export const metadata: Metadata = { title: "System status", description: "Indexer and monitoring worker status for FaultPact.", robots: { index: false, follow: true } };

export default function StatusLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
