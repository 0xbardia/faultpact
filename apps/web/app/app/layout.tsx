import type { Metadata } from "next";

export const metadata: Metadata = { title: "Customer workspace", robots: { index: false, follow: false } };

export default function CustomerWorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
