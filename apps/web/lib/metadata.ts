import type { Metadata } from "next";

export function pageMetadata(title: string, description: string, path: string): Metadata {
  const shareTitle = `${title} | FaultPact`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: shareTitle,
      description,
      type: "website",
      url: path,
      images: [{ url: "/social-preview.png", width: 1200, height: 630, alt: "FaultPact — Reliability with consequences" }],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: ["/social-preview.png"] },
  };
}
