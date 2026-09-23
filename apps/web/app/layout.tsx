import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FaultPact — Reliability with consequences", template: "%s | FaultPact" },
  description: "Providers bond capital behind service SLAs. Customers buy Coverage; evidence informs Incident facts and eligible claims settle by frozen Pact terms.",
  metadataBase: new URL("https://faultpact.bydx.fun"),
  alternates: { canonical: "/" },
  openGraph: { title: "FaultPact — Reliability with consequences", description: "Bonded SLAs, evidence-backed Incident facts, and contract-settled Claims.", type: "website", url: "https://faultpact.bydx.fun", siteName: "FaultPact", images: [{ url: "/social-preview.png", width: 1200, height: 630, alt: "FaultPact — Reliability with consequences" }] },
  twitter: { card: "summary_large_image", title: "FaultPact — Reliability with consequences", description: "Bonded SLAs, evidence-backed Incident facts, and contract-settled Claims.", images: ["/social-preview.png"] },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
