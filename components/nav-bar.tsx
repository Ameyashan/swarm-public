"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { PM_NAV, isActiveNav } from "@/lib/pm-nav"

export { PM_NAV } from "@/lib/pm-nav"

export function NavBar() {
  const pathname = usePathname()
  return (
    <header
      className="sticky top-0 z-30 h-12 w-full border-b backdrop-blur print:hidden"
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
          {PM_NAV.map((l) => {
            const active = isActiveNav(pathname, l.match)
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className="rounded-[5px] px-3 py-[7px] font-mono text-[11.5px] transition-colors hover:bg-bg-2 hover:text-text"
                style={
                  active
                    ? { background: "var(--gs-bg)", color: "var(--gs)" }
                    : { color: "var(--text-dim)" }
                }
              >
                {l.label}
              </Link>
            )
          })}
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
