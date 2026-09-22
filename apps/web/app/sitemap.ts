import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap { const root = "https://faultpact.bydx.fun"; return ["/", "/explore", "/providers", "/services", "/pacts", "/coverages", "/incidents", "/claims", "/monitoring", "/docs", "/docs/getting-started", "/docs/providers", "/docs/customers", "/docs/evidence", "/docs/resolution", "/docs/contract", "/docs/security"].map((path) => ({ url: `${root}${path}`, lastModified: new Date() })); }
