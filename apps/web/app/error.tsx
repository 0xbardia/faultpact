"use client";

import Link from "next/link";
import { Shell } from "../components/shell";
import { PageHeader } from "../components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Shell><main className="content-shell"><PageHeader eyebrow="Application error" title="This view could not load." description="Try again. If the problem continues, return to the public explorer and open the record again." actions={<><button className="button button-coral" onClick={() => reset()}>Try again</button><Link className="button button-quiet" href="/explore">Open explorer</Link></>} /></main></Shell>;
}
