"use client"

import { useMemo, useState } from "react"
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

function fmtBps(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}${Math.abs(n).toFixed(0)} bps`
}

function bpsColor(n: number | null): string {
  if (n === null) return "var(--text-dim)"
  if (n <= -100) return "var(--red)"
  if (n <= -25) return "var(--amber)"
  if (n >= 25) return "var(--green)"
  return "var(--text-dim)"
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

// Sortable columns and their value extractors. Strings sort case-insensitive;
// numerics treat null/undefined as -Infinity so they sink in descending sorts.
type SortKey =
  | "severity"
  | "borrower"
  | "industry"
  | "vintage"
  | "prior_fv"
  | "current_fv"
  | "today_mark"
  | "fv_change_pct"
  | "accrual"
type SortDir = "asc" | "desc" | null

function valueFor(row: BookPositionRow, key: SortKey): number | string | null {
  switch (key) {
    case "severity":
      return row.severity_100
    case "borrower":
      return (row.borrower ?? "").toLowerCase()
    case "industry":
      return (row.industry ?? "").toLowerCase()
    case "vintage":
      return row.vintage ?? ""
    case "prior_fv":
      return row.prior_fv
    case "current_fv":
      return row.current_fv
    case "today_mark":
      return row.today_mark_pct
    case "fv_change_pct":
      return row.fv_change_pct
    case "accrual":
      // non_accrual sinks before accrual when ascending; treats blank as last.
      return row.accrual_status ?? "~"
  }
}

function compareRows(
  a: BookPositionRow,
  b: BookPositionRow,
  key: SortKey,
  dir: SortDir,
): number {
  if (!dir) return 0
  const va = valueFor(a, key)
  const vb = valueFor(b, key)
  const aNull = va === null || va === undefined || (typeof va === "number" && !Number.isFinite(va))
  const bNull = vb === null || vb === undefined || (typeof vb === "number" && !Number.isFinite(vb))
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  let cmp: number
  if (typeof va === "number" && typeof vb === "number") cmp = va - vb
  else cmp = String(va).localeCompare(String(vb))
  return dir === "asc" ? cmp : -cmp
}

function nextDir(prev: SortDir, sameKey: boolean): SortDir {
  if (!sameKey) return "desc"
  if (prev === "desc") return "asc"
  if (prev === "asc") return null
  return "desc"
}

function SortHeader({
  label,
  align,
  active,
  dir,
  onClick,
  padX = "px-3",
}: {
  label: string
  align: "left" | "right"
  active: boolean
  dir: SortDir
  onClick: () => void
  padX?: string
}) {
  const arrow = !active || !dir ? "↕" : dir === "asc" ? "↑" : "↓"
  return (
    <th
      className={`${padX} py-2 ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={
        active && dir ? (dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-text"
        style={{ color: active ? "var(--text)" : "var(--text-faint)" }}
      >
        <span>{label}</span>
        <span aria-hidden style={{ opacity: active ? 1 : 0.45 }}>
          {arrow}
        </span>
      </button>
    </th>
  )
}

export function PositionsTable({
  rows,
  tab,
}: {
  rows: BookPositionRow[]
  tab: BookTab
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "severity",
    dir: null,
  })

  const sortedRows = useMemo(() => {
    if (!sort.dir) return rows
    return [...rows].sort((a, b) => compareRows(a, b, sort.key, sort.dir))
  }, [rows, sort])

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

  // Only the flat (non-grouped) views are user-sortable. Grouped tabs
  // (vintage/sector/sponsor) keep server-side grouping so the bucket
  // structure stays meaningful.
  const grouped = tab === "vintage" || tab === "sector" || tab === "sponsor"
  const displayRows = grouped ? rows : sortedRows

  type Group = { key: string; rows: BookPositionRow[] }
  const groups: Group[] = []
  if (grouped) {
    const byKey = new Map<string, BookPositionRow[]>()
    for (const r of displayRows) {
      const k = groupKey(r, tab)
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k)!.push(r)
    }
    Array.from(byKey.entries()).forEach(([key, list]) => {
      groups.push({ key, rows: list })
    })
  } else {
    groups.push({ key: "", rows: displayRows })
  }

  function handleSort(key: SortKey) {
    setSort((prev) => {
      const sameKey = prev.key === key
      const dir = nextDir(prev.dir, sameKey)
      return dir ? { key, dir } : { key, dir: null }
    })
  }

  const canSort = !grouped

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
          {canSort && sort.dir ? (
            <span className="ml-2 normal-case tracking-normal text-text-dim">
              · sorted by {sort.key.replace(/_/g, " ")} {sort.dir}
            </span>
          ) : null}
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
                {canSort ? (
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <SortHeader
                      label="sev"
                      align="left"
                      padX="px-5"
                      active={sort.key === "severity"}
                      dir={sort.key === "severity" ? sort.dir : null}
                      onClick={() => handleSort("severity")}
                    />
                    <SortHeader
                      label="borrower"
                      align="left"
                      active={sort.key === "borrower"}
                      dir={sort.key === "borrower" ? sort.dir : null}
                      onClick={() => handleSort("borrower")}
                    />
                    <SortHeader
                      label="industry"
                      align="left"
                      active={sort.key === "industry"}
                      dir={sort.key === "industry" ? sort.dir : null}
                      onClick={() => handleSort("industry")}
                    />
                    <SortHeader
                      label="vintage"
                      align="left"
                      active={sort.key === "vintage"}
                      dir={sort.key === "vintage" ? sort.dir : null}
                      onClick={() => handleSort("vintage")}
                    />
                    <SortHeader
                      label="prior FV"
                      align="right"
                      active={sort.key === "prior_fv"}
                      dir={sort.key === "prior_fv" ? sort.dir : null}
                      onClick={() => handleSort("prior_fv")}
                    />
                    <SortHeader
                      label="current FV"
                      align="right"
                      active={sort.key === "current_fv"}
                      dir={sort.key === "current_fv" ? sort.dir : null}
                      onClick={() => handleSort("current_fv")}
                    />
                    <SortHeader
                      label="today’s mark"
                      align="right"
                      active={sort.key === "today_mark"}
                      dir={sort.key === "today_mark" ? sort.dir : null}
                      onClick={() => handleSort("today_mark")}
                    />
                    <SortHeader
                      label="change"
                      align="right"
                      active={sort.key === "fv_change_pct"}
                      dir={sort.key === "fv_change_pct" ? sort.dir : null}
                      onClick={() => handleSort("fv_change_pct")}
                    />
                    <SortHeader
                      label="accrual"
                      align="left"
                      active={sort.key === "accrual"}
                      dir={sort.key === "accrual" ? sort.dir : null}
                      onClick={() => handleSort("accrual")}
                    />
                    <th className="px-5 py-2 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
                      filing
                    </th>
                  </tr>
                ) : (
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
                    <th className="px-3 py-2 text-right">today’s mark</th>
                    <th className="px-3 py-2 text-right">change</th>
                    <th className="px-3 py-2 text-left">accrual</th>
                    <th className="px-5 py-2 text-left">filing</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const sev = r.severity_100
                  const chip = severityChip(sev)
                  const isNonAccrual = r.accrual_status === "non_accrual"
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
                        <div className="mt-0.5 font-mono text-[10.5px] text-text-faint">
                          {r.detector_name.replace(/_/g, " ")}
                          {r.is_pik === true ? " · PIK" : ""}
                        </div>
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
                      <td className="px-3 py-3 align-top text-right font-mono text-[11.5px] tabular-nums">
                        {r.today_mark_pct === null || !Number.isFinite(r.today_mark_pct) ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <>
                            <div className="text-text">
                              {r.today_mark_pct.toFixed(1)}
                              {r.today_requires_review ? (
                                <span
                                  className="ml-1 text-[10px]"
                                  style={{ color: "var(--amber)" }}
                                  title="requires review"
                                >
                                  ⚑
                                </span>
                              ) : null}
                            </div>
                            <div
                              className="mt-0.5 text-[10.5px]"
                              style={{ color: bpsColor(r.today_delta_bps) }}
                            >
                              {fmtBps(r.today_delta_bps)}
                            </div>
                          </>
                        )}
                      </td>
                      <td
                        className="px-3 py-3 align-top text-right font-mono text-[11.5px] font-medium tabular-nums"
                        style={{ color: changeColor(r.fv_change_pct) }}
                      >
                        {fmtChange(r.fv_change_pct)}
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-[11px]">
                        {r.accrual_status ? (
                          <span
                            style={{
                              color: isNonAccrual ? "var(--red)" : "var(--text-dim)",
                            }}
                          >
                            {r.accrual_status.replace(/_/g, "-")}
                          </span>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
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
