import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "./site";

export function Shell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <div className={dark ? "site site-dark" : "site"}><a className="skip-link" href="#main-content">Skip to main content</a><SiteHeader /><div id="main-content" tabIndex={-1}>{children}</div><SiteFooter /></div>;
}
