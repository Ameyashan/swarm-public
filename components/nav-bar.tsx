import Link from "next/link"

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/funds", label: "Funds" },
  { href: "/alerts", label: "Alerts" },
  { href: "/case-studies", label: "Case Studies" },
  { href: "/about", label: "About" },
]

export function NavBar() {
  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
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
      </div>
    </header>
  )
}
