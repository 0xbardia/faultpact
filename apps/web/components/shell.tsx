import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "./site";

export function Shell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <div className={dark ? "site site-dark" : "site"}><SiteHeader />{children}<SiteFooter /></div>;
}

