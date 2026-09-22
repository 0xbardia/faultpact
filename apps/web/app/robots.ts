import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots { return { rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/provider"] }], sitemap: "https://faultpact.bydx.fun/sitemap.xml" }; }
