import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const root = "https://faultpact.bydx.fun";
  const paths = [
    "/", "/explore", "/providers", "/services", "/pacts", "/coverages", "/incidents", "/claims", "/monitoring", "/docs",
    "/docs/getting-started", "/docs/providers", "/docs/providers/services", "/docs/providers/pacts", "/docs/providers/capital",
    "/docs/customers", "/docs/customers/coverage", "/docs/customers/incidents", "/docs/customers/claims",
    "/docs/monitoring", "/docs/evidence", "/docs/resolution", "/docs/challenges", "/docs/protocol", "/docs/contract", "/docs/network", "/docs/security", "/docs/api",
  ];
  return paths.map((path) => ({ url: `${root}${path}` }));
}
