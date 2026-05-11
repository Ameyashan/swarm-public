import Link from "next/link"
import { PM_NAV } from "@/lib/pm-nav"

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-[860px] flex-col gap-8 py-16">
      <header>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[1.5px] text-text-faint">
          404 · not in the workspace
        </div>
        <h1 className="font-serif text-[34px] font-normal leading-[1.15] tracking-[-0.6px] text-text">
          That page isn&rsquo;t part of the PM workspace.
        </h1>
        <p className="mt-3 max-w-[640px] font-serif text-[16px] leading-[1.6] text-text-dim">
          The v1 marketing site has been retired. Everything lives under one
          of the six surfaces below — pick the one closest to what you were
          looking for.
        </p>
      </header>

      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        style={{ listStyle: "none" }}
      >
        {PM_NAV.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="block rounded-[8px] border bg-bg-1 px-4 py-3 transition-colors hover:border-accent hover:bg-accent-soft"
              style={{ borderColor: "var(--line)" }}
            >
              <div className="font-mono text-[10.5px] uppercase tracking-[1.4px] text-text-faint">
                {l.href}
              </div>
              <div className="mt-1 font-serif text-[15px] text-text">
                {l.label}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
