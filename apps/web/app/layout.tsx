import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FaultPact — Reliability with consequences", template: "%s · FaultPact" },
  description: "Service reliability exchange with bonded SLAs, verifiable evidence, and deterministic settlement.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://faultpact.bydx.fun"),
  openGraph: { title: "FaultPact — Reliability with consequences", description: "Coverage backed by bonded Provider capital.", type: "website" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
