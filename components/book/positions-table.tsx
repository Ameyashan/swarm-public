import Link from "next/link"
import type { BookPositionRow, BookTab } from "@/lib/book/queries"

function fmtFv(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  const v = Math.abs(n)
  if (v >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}${Math.abs(n).toFixed(1)}%`
}

function changeColor(n: number | null): string {
  if (n === null) return "var(--text-dim)"
  if (n <= -25) return "var(--red)"
  if (n <= -10) return "var(--amber)"
  if (n > 0) return "var(--green)"
  return "var(--text-dim)"
}

function severityChip(sev: number) {
  let bg = "var(--bg-2)"
  let fg = "var(--text-dim)"
  if (sev >= 70) {
    bg = "var(--red-bg)"
    fg = "var(--red)"
  } else if (sev >= 40) {
    bg = "var(--amber-bg)"
    fg = "var(--amber)"
  } else if (sev > 0) {
    bg = "var(--green-bg)"
    fg = "var(--green)"
  }
  return { bg, fg }
}

function groupTitle(tab: BookTab): string {
  if (tab === "deteriorating")
    return "deteriorating positions · severity ≥ 60 or FV down ≥ 25%"
  if (tab === "watchlist") return "watchlist · severity 40–69, elevated PIK, or modest mark drift"
  if (tab === "non_accrual") return "non-accrual positions · latest filings"
  if (tab === "vintage") return "flagged positions grouped by vintage"
  if (tab === "sector") return "flagged positions grouped by sector"
  if (tab === "sponsor") return "flagged positions grouped by sponsor"
  return "all flagged positions"
}

function groupKey(row: BookPositionRow, tab: BookTab): string {
  if (tab === "vintage") return row.vintage ?? "Unknown vintage"
  if (tab === "sector") return row.industry ?? "Unknown sector"
  if (tab === "sponsor") return row.sponsor ?? "Unknown sponsor"
  return ""
}

export function PositionsTable({
  rows,
  tab,
}: {
  rows: BookPositionRow[]
  tab: BookTab
}) {
  if (rows.length === 0) {
    return (
      <section
        className="rounded-[10px] border px-6 py-10 text-center"
        style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
      >
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-faint">
          no positions
        </div>
        <p className="font-serif italic text-text-dim">
          No flagged positions match this view in the latest data.
        </p>
      </section>
    )
  }

  const grouped = tab === "vintage" || tab === "sector" || tab === "sponsor"

  // For grouped views, build group buckets in order encountered.
  type Group = { key: string; rows: BookPositionRow[] }
  const groups: Group[] = []
  if (grouped) {
    const byKey = new Map<string, BookPositionRow[]>()
    for (const r of rows) {
      const k = groupKey(r, tab)
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k)!.push(r)
    }
    Array.from(byKey.entries()).forEach(([key, list]) => {
      groups.push({ key, rows: list })
    })
  } else {
    groups.push({ key: "", rows })
  }

  return (
    <section
      className="rounded-[10px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-dim">
          {groupTitle(tab)}
        </div>
        <div className="font-mono text-[10.5px] text-text-faint">
          {rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"}
        </div>
      </div>

      <div className="overflow-x-auto">
        {groups.map((g) => (
          <div key={g.key || "_"}>
            {g.key && (
              <div
                className="border-t px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-faint"
                style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}
              >
                {g.key}{" "}
                <span className="ml-2 normal-case tracking-normal text-text-dim">
                  {g.rows.length} {g.rows.length === 1 ? "name" : "names"}
                </span>
              </div>
            )}
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint"
                  style={{ borderBottom: "1px solid var(--line)" }}
                >
                  <th className="px-5 py-2 text-left">sev</th>
                  <th className="px-3 py-2 text-left">borrower</th>
                  <th className="px-3 py-2 text-left">industry</th>
                  <th className="px-3 py-2 text-left">vintage</th>
                  <th className="px-3 py-2 text-right">prior FV</th>
                  <th className="px-3 py-2 text-right">current FV</th>
                  <th className="px-3 py-2 text-right">change</th>
                  <th className="px-5 py-2 text-left">filing</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const sev = r.severity_100
                  const chip = severityChip(sev)
                  const isNonAccrual = r.accrual_status === "non_accrual"
                  const subParts: string[] = []
                  if (r.detector_name) subParts.push(r.detector_name)
                  if (isNonAccrual) subParts.push("non-accrual")
                  else if (r.is_pik) subParts.push("PIK")
                  return (
                    <tr
                      key={r.hit_id}
                      className="transition-colors hover:bg-bg-2"
                      style={{ borderBottom: "1px solid var(--line)" }}
                    >
                      <td className="px-5 py-3 align-top">
                        <span
                          className="inline-flex h-7 w-9 items-center justify-center rounded-[6px] font-mono text-[11.5px] font-semibold"
                          style={{ background: chip.bg, color: chip.fg }}
                        >
                          {sev}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-serif text-[13.5px] leading-[1.3] text-text">
                          {r.borrower ? (
                            <Link
                              href={`/borrower/${encodeURIComponent(r.borrower)}`}
                              className="text-text hover:text-accent hover:underline"
                            >
                              {r.borrower}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </div>
                        {subParts.length > 0 && (
                          <div className="mt-0.5 font-mono text-[10.5px] text-text-faint">
                            {subParts.join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-[11px] text-text-dim">
                        {r.industry ?? "—"}
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-[11px] text-text-dim">
                        {r.vintage ?? "—"}
                      </td>
                      <td className="px-3 py-3 align-top text-right font-mono text-[11.5px] tabular-nums text-text">
                        {fmtFv(r.prior_fv)}
                      </td>
                      <td className="px-3 py-3 align-top text-right font-mono text-[11.5px] tabular-nums text-text">
                        {fmtFv(r.current_fv)}
                      </td>
                      <td
                        className="px-3 py-3 align-top text-right font-mono text-[11.5px] font-medium tabular-nums"
                        style={{ color: changeColor(r.fv_change_pct) }}
                      >
                        {fmtChange(r.fv_change_pct)}
                      </td>
                      <td className="px-5 py-3 align-top font-mono text-[10.5px] text-text-dim">
                        {r.filing_url ? (
                          <Link
                            href={r.filing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline-offset-4 hover:underline"
                          >
                            {r.filing_label ?? "view filing"}
                          </Link>
                        ) : (
                          <span>{r.filing_label ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  )
}
