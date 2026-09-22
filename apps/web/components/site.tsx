"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { connectWallet, FAULTPACT_CHAIN_ID, provider, switchToFaultPact, walletAccounts, walletChainId } from "../lib/wallet";
import { formatAddress } from "../lib/format";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return <header className="site-header"><div className="nav-shell">
    <Link className="brand" href="/" onClick={() => setOpen(false)}><span className="brand-mark">F</span><span>FAULT<span className="brand-slash">/</span>PACT</span></Link>
    <nav className={`nav-links ${open ? "nav-open" : ""}`} aria-label="Primary navigation">
      <Link href="/explore" onClick={() => setOpen(false)}>Explore</Link>
      <Link href="/providers" onClick={() => setOpen(false)}>Providers</Link>
      <Link href="/incidents" onClick={() => setOpen(false)}>Incidents</Link>
      <Link href="/monitoring" onClick={() => setOpen(false)}>Monitoring</Link>
      <Link href="/docs" onClick={() => setOpen(false)}>Docs</Link>
      <Link className="nav-app" href="/app" onClick={() => setOpen(false)}>Open app <span>↗</span></Link>
    </nav>
    <div className="nav-actions"><NetworkMark /><WalletButton /></div>
    <button className="menu-button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span /><span /></button>
  </div></header>;
}

function NetworkMark() {
  return <span className="network-mark"><span className="status-dot" />Studio Dev · {FAULTPACT_CHAIN_ID}</span>;
}

export function WalletButton() {
  const [address, setAddress] = useState<string>();
  const [chain, setChain] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const injected = provider();
    if (!injected) return;
    const refresh = () => void Promise.all([walletAccounts(), walletChainId()]).then(([accounts, chainId]) => { setAddress(accounts[0]); setChain(chainId); }).catch(() => undefined);
    refresh();
    const onAccounts = (...args: unknown[]) => { const accounts = Array.isArray(args[0]) ? args[0].filter((item): item is string => typeof item === "string") : []; setAddress(accounts[0]); };
    const onChain = () => void walletChainId().then(setChain).catch(() => undefined);
    injected.on?.("accountsChanged", onAccounts);
    injected.on?.("chainChanged", onChain);
    return () => { injected.removeListener?.("accountsChanged", onAccounts); injected.removeListener?.("chainChanged", onChain); };
  }, []);

  async function handleClick() {
    setError(undefined); setBusy(true);
    try {
      if (!address) { const result = await connectWallet(); setAddress(result.address); setChain(result.chainId); }
      else if (chain !== FAULTPACT_CHAIN_ID) { await switchToFaultPact(); setChain(await walletChainId()); }
      else setAddress(undefined);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Wallet action failed"); }
    finally { setBusy(false); }
  }

  const label = busy ? "Connecting…" : !address ? "Connect wallet" : chain !== FAULTPACT_CHAIN_ID ? "Switch to Studio Dev" : formatAddress(address);
  return <div className="wallet-wrap"><button className={`wallet-button ${chain !== null && chain !== FAULTPACT_CHAIN_ID ? "wallet-wrong" : ""}`} onClick={() => void handleClick()} aria-label={label}>{label}</button>{error ? <span className="wallet-error" role="alert">{error}</span> : null}</div>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div className="footer-grid"><div><Link className="brand footer-brand" href="/"><span className="brand-mark">F</span><span>FAULT<span className="brand-slash">/</span>PACT</span></Link><p>Reliability with consequences.</p></div><div><p className="footer-label">Product</p><Link href="/explore">Explore</Link><Link href="/monitoring">Monitoring</Link><Link href="/app">Customer app</Link><Link href="/provider">Provider console</Link></div><div><p className="footer-label">Learn</p><Link href="/docs">Documentation</Link><Link href="/docs/evidence">Evidence model</Link><Link href="/docs/contract">Contract</Link><Link href="/docs/network">Network</Link></div><div><p className="footer-label">Protocol</p><a href="https://github.com/0xbardia/faultpact" target="_blank" rel="noreferrer">GitHub ↗</a><Link href="/status">Status</Link><span className="mono footer-contract">61997 / 0xeb85…6Bf13</span></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} FaultPact</span><span>GenLayer Studio Development Preview · Chain 61997</span></div></footer>;
}

