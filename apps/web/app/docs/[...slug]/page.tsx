import { Shell } from "../../../components/shell";
import { DocArticle, DocsLayout, docs } from "../../../components/docs";

export function generateStaticParams() { return Object.keys(docs).map((slug) => ({ slug: slug.split("/") })); }

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug.join("/");
  return <Shell><DocsLayout slug={slug}><DocArticle slug={slug} /></DocsLayout></Shell>;
}
