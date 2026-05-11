import Link from "next/link"

// Six surfaces of the PM workflow, in the exact order required by the spec.
// Path "/borrower/MRI%20Software" matches the prompt verbatim — the borrower
// X-ray landing route uses MRI Software as the default canonical example.
export const PM_NAV: Array<{
  href: string
  label: string
  badge?: string
}> = [
  { href: "/", label: "Briefing" },
  { href: "/book", label: "Position book" },
  { href: "/borrower/MRI%20Software", label: "Borrower x-ray" },
  { href: "/peer", label: "Peer telemetry" },
  { href: "/patterns", label: "Patterns" },
  { href: "/memo", label: "Memo composer" },
]

export function NavBar() {
  return (
    <header
      className="sticky top-0 z-30 h-12 w-full border-b backdrop-blur"
      style={{
        background: "rgba(245, 241, 232, 0.92)",
        borderColor: "var(--line)",
      }}
    >
      <div className="mx-auto flex h-full max-w-[1280px] items-center gap-4 px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono text-[13px] font-medium tracking-tight text-text"
        >
          <span
            className="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] font-mono text-[11px] font-semibold"
            style={{ background: "var(--gs)", color: "var(--bg)" }}
            aria-hidden
          >
            s
          </span>
          <span>swarm</span>
        </Link>

        <nav className="ml-3 flex items-center gap-[2px]" aria-label="PM workspace">
          {PM_NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-[5px] px-3 py-[7px] font-mono text-[11.5px] text-text-dim transition-colors hover:bg-bg-2 hover:text-text"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 font-mono text-[11px] text-text-dim">
          <span className="flex items-center gap-2">
            <span className="pulse-dot" aria-hidden />
            <span>live · EDGAR</span>
          </span>
          <span
            className="flex items-center gap-2 rounded-full border px-[10px] py-1 pl-1"
            style={{ borderColor: "var(--line)" }}
          >
            <span
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9.5px] font-semibold"
              style={{
                background:
                  "linear-gradient(135deg, var(--gs), #6b5618)",
                color: "var(--bg)",
                fontFamily: "var(--font-mono)",
              }}
              aria-hidden
            >
              AS
            </span>
            <span style={{ color: "var(--gs)" }}>Goldman Sachs</span>
            <span className="text-text-dim">· PM</span>
          </span>
        </div>
      </div>
    </header>
  )
}
