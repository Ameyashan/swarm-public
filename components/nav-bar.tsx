import Link from "next/link"
import { Suspense } from "react"
import { FreshnessIndicator } from "@/components/freshness-indicator"

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/drift", label: "Drift" },
  { href: "/funds", label: "Funds" },
  { href: "/alerts", label: "Alerts" },
  { href: "/case-studies", label: "Case Studies" },
  { href: "/about", label: "About" },
]

export function NavBar() {
  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-6">
        <Link
          href="/"
          className="font-mono text-sm font-semibold tracking-tight"
        >
          swarm/public
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 sm:flex">
          <CommandHint />
          <Suspense fallback={<FreshnessFallback />}>
            <FreshnessIndicator />
          </Suspense>
        </div>
      </div>
    </header>
  )
}

function CommandHint() {
  return (
    <button
      data-cmdk-trigger
      type="button"
      className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-border bg-[#0F1623] px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-blue-500/30 hover:text-foreground"
      aria-label="Open command palette"
    >
      <span>Search</span>
      <kbd className="font-mono text-[10px]">⌘K</kbd>
    </button>
  )
}

function FreshnessFallback() {
  return (
    <div className="inline-flex h-[24px] w-[58px] items-center rounded-full border border-border bg-[#0F1623]" />
  )
}
