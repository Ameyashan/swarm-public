import Link from "next/link"

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-default bg-card/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: brand + tagline */}
        <div className="flex max-w-sm flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-severity-critical shadow-[0_0_8px_var(--tw-shadow-color)] shadow-severity-critical" />
            <span className="font-semibold text-default">Swarm Public</span>
          </div>
          <p className="text-xs text-muted">
            Agentic intelligence for public private credit. Live monitoring of
            every BDC filing on EDGAR. Every alert cited.
          </p>
        </div>

        {/* Middle: site links */}
        <nav className="flex flex-col gap-2 text-xs">
          <span className="font-mono uppercase tracking-[0.18em] text-dim">
            Product
          </span>
          <Link href="/alerts" className="text-muted hover:text-default">
            Alerts
          </Link>
          <Link href="/drift" className="text-muted hover:text-default">
            Drift screener
          </Link>
          <Link href="/heatmap" className="text-muted hover:text-default">
            Heatmap
          </Link>
          <Link href="/funds" className="text-muted hover:text-default">
            Funds
          </Link>
          <Link href="/case-studies" className="text-muted hover:text-default">
            Case studies
          </Link>
        </nav>

        {/* Right: about + community */}
        <nav className="flex flex-col gap-2 text-xs">
          <span className="font-mono uppercase tracking-[0.18em] text-dim">
            Learn
          </span>
          <Link href="/about" className="text-muted hover:text-default">
            How it works
          </Link>
          <Link href="/methodology" className="text-muted hover:text-default">
            Methodology
          </Link>
          <a
            href="https://twitter.com/swarmpublic"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-default"
          >
            Twitter / X ↗
          </a>
          <a
            href="https://github.com/swarmpublic/swarm-public"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-default"
          >
            GitHub ↗
          </a>
        </nav>
      </div>

      <div className="border-t border-default/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-4 text-[11px] text-dim sm:flex-row sm:items-center sm:justify-between">
          <span>
            Live data from SEC EDGAR. Not investment advice. © 2026 Swarm Public.
          </span>
          <span className="font-mono uppercase tracking-[0.18em]">
            Built for credit analysts who actually read the footnotes.
          </span>
        </div>
      </div>
    </footer>
  )
}
