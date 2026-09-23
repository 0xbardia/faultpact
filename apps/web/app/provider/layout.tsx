import type { Metadata } from "next";

export const metadata: Metadata = { title: "Provider console", robots: { index: false, follow: false } };

export default function ProviderConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
