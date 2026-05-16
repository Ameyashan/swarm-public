import Link from "next/link"
import type { BiggestMover } from "@/lib/nav/queries"

function fmtBps(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}${Math.abs(n).toFixed(0)} bps`
}

function bpsColor(n: number): string {
  if (!Number.isFinite(n)) return "var(--text-dim)"
  if (n <= -150) return "var(--red)"
  if (n <= -50) return "var(--amber)"
  if (n >= 50) return "var(--green)"
  return "var(--text-dim)"
}

export function DailyMovers({ rows }: { rows: BiggestMover[] }) {
  if (rows.length === 0) {
    return (
      <section
        className="rounded-md border px-5 py-4 font-mono text-[11.5px] text-text-faint"
        style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
      >
        biggest daily movers · no daily marks yet —{" "}
        <Link href="/nav" className="text-accent underline-offset-4 hover:underline">
          set up Daily NAV
        </Link>
      </section>
    )
  }
  const asOf = rows[0]?.mark_date ?? "—"
  return (
    <section
      className="rounded-md border"
      style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
    >
      <div
        className="flex items-baseline justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
            biggest daily movers · {asOf}
          </div>
          <div className="mt-0.5 font-serif text-[14px] italic text-text-dim">
            Top {rows.length} positions by |Δ bps| since prior model mark
          </div>
        </div>
        <Link
          href="/nav"
          className="font-mono text-[10.5px] text-accent underline-offset-4 hover:underline"
        >
          full table →
        </Link>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-baseline justify-between gap-4 border-b px-5 py-2 last:border-b-0"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="min-w-0">
              <Link
                href={`/borrower/${encodeURIComponent(r.portfolio_company_canonical)}`}
                className="font-serif text-[14px] text-text hover:text-accent hover:underline"
              >
                {r.portfolio_company_canonical}
              </Link>
              <div className="font-mono text-[10.5px] text-text-faint">
                {r.fund_ticker}
                {r.requires_review ? (
                  <span className="ml-2" style={{ color: "var(--amber)" }}>
                    ⚑ review
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <div
                className="font-mono text-[13px] tabular-nums"
                style={{ color: bpsColor(Number(r.delta_bps)) }}
              >
                {fmtBps(Number(r.delta_bps))}
              </div>
              {r.mark_pct !== null && Number.isFinite(r.mark_pct) ? (
                <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-text-dim">
                  mark {Number(r.mark_pct).toFixed(1)}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
