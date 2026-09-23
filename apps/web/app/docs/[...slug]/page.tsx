import { notFound } from "next/navigation";
import { pageMetadata } from "../../../lib/metadata";
import { Shell } from "../../../components/shell";
import { DocArticle, DocsLayout, docs } from "../../../components/docs";

export function generateStaticParams() { return Object.keys(docs).map((slug) => ({ slug: slug.split("/") })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug.join("/");
  const article = docs[slug];
  return pageMetadata(article?.title ?? "Documentation page not found", article?.description ?? "This FaultPact documentation page does not exist.", `/docs/${slug}`);
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug.join("/");
  if (!docs[slug]) notFound();
  return <Shell><DocsLayout slug={slug}><DocArticle slug={slug} /></DocsLayout></Shell>;
}
