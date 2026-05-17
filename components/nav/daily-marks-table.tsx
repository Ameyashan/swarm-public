"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type {
  DailyMarkHistoryPoint,
  DailyMarkRow,
  MarkOverrideRow,
} from "@/lib/nav/queries"
import { MethodologyDrawer } from "@/components/nav/methodology-drawer"

// Compact per-row sparkline of the last N daily marks. Fixed dimensions so
// the column stays narrow and rows align. Points missing mark_pct are dropped.
function HistorySpark({ points }: { points: DailyMarkHistoryPoint[] }) {
  const W = 64
  const H = 22
  const valid = points.filter(
    (p) => p.mark_pct !== null && Number.isFinite(p.mark_pct),
  )
  if (valid.length < 2) {
    return (
      <span className="font-mono text-[10px] text-text-faint">
        {valid.length === 1 ? "1 mark" : "no history"}
      </span>
    )
  }
  const marks = valid.map((p) => p.mark_pct as number)
  const yMin = Math.min(...marks)
  const yMax = Math.max(...marks)
  const span = Math.max(0.1, yMax - yMin)
  const xFor = (i: number) =>
    valid.length === 1 ? W / 2 : (i / (valid.length - 1)) * W
  const yFor = (m: number) => H - ((m - yMin) / span) * H
  const d = valid
    .map((p, i) => {
      const x = xFor(i)
      const y = yFor(p.mark_pct as number)
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(" ")
  const last = valid[valid.length - 1]
  const first = valid[0]
  const drift =
    first.mark_pct && Number.isFinite(first.mark_pct)
      ? (last.mark_pct as number) - (first.mark_pct as number)
      : 0
  const stroke = drift < -0.5 ? "var(--red)" : drift > 0.5 ? "var(--green)" : "var(--gs)"
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`${valid.length}-day mark trajectory`}
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.4} />
      <circle cx={xFor(valid.length - 1)} cy={yFor(last.mark_pct as number)} r={1.8} fill={stroke} />
    </svg>
  )
}

function fmtFv(thousands: number | null): string {
  if (thousands === null || !Number.isFinite(thousands)) return "—"
  const dollars = thousands * 1000
  const v = Math.abs(dollars)
  if (v >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`
  return `$${dollars.toFixed(0)}`
}

function fmtBps(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps)) return "—"
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : ""
  return `${sign}${Math.abs(bps).toFixed(0)} bps`
}

function bpsColor(bps: number | null): string {
  if (bps === null) return "var(--text-dim)"
  if (bps <= -150) return "var(--red)"
  if (bps <= -50) return "var(--amber)"
  if (bps >= 50) return "var(--green)"
  return "var(--text-dim)"
}

function confidenceBadge(c: "low" | "med" | "high"): { bg: string; fg: string; label: string } {
  if (c === "low") return { bg: "var(--red-bg)", fg: "var(--red)", label: "low" }
  if (c === "med") return { bg: "var(--amber-bg)", fg: "var(--amber)", label: "med" }
  return { bg: "var(--green-bg)", fg: "var(--green)", label: "high" }
}

// Compact stacked bar showing pillar contributions for the row's spread delta.
function PillarBar({ row }: { row: DailyMarkRow }) {
  const comp = row.components ?? {}
  const a = Number(comp.pillar_a_spread_delta_bps ?? 0)
  const b = Number(comp.pillar_b_spread_delta_bps ?? 0)
  const idio = Number(comp.idio_shock_pct ?? 0) * 10000 // pct → bps for visual
  const parts = [
    { key: "DCF", v: a, color: "var(--gs)" },
    { key: "MKT", v: b, color: "var(--accent)" },
    { key: "IDIO", v: idio, color: "var(--red)" },
  ]
  const max = Math.max(50, ...parts.map((p) => Math.abs(p.v)))
  return (
    <div className="flex items-center gap-1" title="DCF · market-comp · idio overlay (bps)">
      {parts.map((p) => {
        const pct = Math.min(1, Math.abs(p.v) / max)
        return (
          <div
            key={p.key}
            className="h-[18px] w-[10px] rounded-[2px]"
            style={{
              background: p.color,
              opacity: 0.15 + 0.85 * pct,
            }}
          />
        )
      })}
    </div>
  )
}

type SortKey = "delta_bps" | "borrower" | "fund" | "fair_value" | "mark_pct" | "confidence" | "flag"
type SortDir = "asc" | "desc"

export function DailyMarksTable({
  rows,
  overrides,
  historyByBorrower,
}: {
  rows: DailyMarkRow[]
  overrides: MarkOverrideRow[]
  historyByBorrower?: Map<string, DailyMarkHistoryPoint[]>
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<"all" | "review" | "down" | "up">("all")
  const [sortKey, setSortKey] = useState<SortKey>("delta_bps")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [active, setActive] = useState<DailyMarkRow | null>(null)

  const overrideCountByKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of overrides) {
      const k = `${o.fund_ticker}::${o.portfolio_company_canonical}::${o.override_date}`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [overrides])

  const filtered = useMemo(() => {
    let out = rows
    if (filter === "review") out = out.filter((r) => r.requires_review)
    if (filter === "down") out = out.filter((r) => (r.delta_bps ?? 0) < 0)
    if (filter === "up") out = out.filter((r) => (r.delta_bps ?? 0) > 0)
    const dir = sortDir === "asc" ? 1 : -1
    return [...out].sort((a, b) => {
      let av: number | string = 0
      let bv: number | string = 0
      switch (sortKey) {
        case "delta_bps":
          av = a.delta_bps ?? 0; bv = b.delta_bps ?? 0; break
        case "borrower":
          av = a.portfolio_company_canonical.toLowerCase()
          bv = b.portfolio_company_canonical.toLowerCase()
          break
        case "fund":
          av = a.fund_ticker.toLowerCase()
          bv = b.fund_ticker.toLowerCase()
          break
        case "fair_value":
          av = a.fair_value_estimated; bv = b.fair_value_estimated; break
        case "mark_pct":
          av = a.mark_pct ?? -Infinity; bv = b.mark_pct ?? -Infinity; break
        case "confidence":
          av = a.confidence; bv = b.confidence; break
        case "flag":
          av = a.requires_review ? 1 : 0
          bv = b.requires_review ? 1 : 0
          break
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [rows, filter, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir(k === "borrower" || k === "fund" ? "asc" : "desc") }
  }

  function HeaderCell({
    k, label, align,
  }: { k: SortKey; label: string; align?: "right" }) {
    const active = sortKey === k
    return (
      <th
        scope="col"
        className={`cursor-pointer select-none px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.1em] ${align === "right" ? "text-right" : "text-left"}`}
        style={{ color: active ? "var(--text)" : "var(--text-faint)" }}
        onClick={() => toggleSort(k)}
      >
        {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "down", "up", "review"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="rounded-[5px] px-3 py-1 font-mono text-[11px] transition-colors"
            style={
              filter === f
                ? { background: "var(--gs-bg)", color: "var(--gs)" }
                : { color: "var(--text-dim)", background: "var(--bg-1)" }
            }
          >
            {f === "all" ? "all" : f === "review" ? "review queue" : f === "down" ? "down today" : "up today"}
          </button>
        ))}
        <div className="ml-auto font-mono text-[10.5px] text-text-faint">
          showing {filtered.length} of {rows.length}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--line)" }}>
        <table className="w-full border-collapse text-[13px]">
          <thead style={{ background: "var(--bg-1)" }}>
            <tr style={{ borderBottom: "0.5px solid var(--line)" }}>
              <HeaderCell k="borrower" label="borrower" />
              <HeaderCell k="fund" label="fund" />
              <th scope="col" className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: "var(--text-faint)" }}>
                pillars
              </th>
              <th scope="col" className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: "var(--text-faint)" }}>
                30d trail
              </th>
              <HeaderCell k="fair_value" label="today FV" align="right" />
              <HeaderCell k="delta_bps" label="Δ bps" align="right" />
              <HeaderCell k="mark_pct" label="mark %" align="right" />
              <HeaderCell k="confidence" label="conf" align="right" />
              <HeaderCell k="flag" label="flag" align="right" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const conf = confidenceBadge(r.confidence)
              const overrideCount = overrideCountByKey.get(
                `${r.fund_ticker}::${r.portfolio_company_canonical}::${r.mark_date}`,
              ) ?? 0
              return (
                <tr
                  key={r.id}
                  className="cursor-pointer transition-colors hover:bg-bg-2"
                  style={{ borderTop: "0.5px solid var(--line)" }}
                  onClick={() => setActive(r)}
                >
                  <td className="px-3 py-2 font-serif text-[14px] text-text">
                    {r.portfolio_company_canonical}
                    <div className="font-mono text-[10.5px] text-text-faint">
                      {r.methodology_version}
                      {overrideCount > 0 ? (
                        <span className="ml-2" style={{ color: "var(--accent)" }}>
                          {overrideCount} override{overrideCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] uppercase tracking-[0.04em] text-text-dim">
                    {r.fund_ticker}
                  </td>
                  <td className="px-3 py-2"><PillarBar row={r} /></td>
                  <td className="px-3 py-2">
                    <HistorySpark
                      points={historyByBorrower?.get(r.portfolio_company_canonical) ?? []}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12.5px] tabular-nums">
                    {fmtFv(r.fair_value_estimated)}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono text-[12.5px] tabular-nums"
                    style={{ color: bpsColor(r.delta_bps) }}
                  >
                    {fmtBps(r.delta_bps)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12.5px] tabular-nums">
                    {r.mark_pct !== null && Number.isFinite(r.mark_pct)
                      ? `${r.mark_pct.toFixed(1)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className="rounded-[3px] px-[6px] py-[2px] font-mono text-[10px] uppercase"
                      style={{ background: conf.bg, color: conf.fg }}
                    >
                      {conf.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[10.5px]">
                    {r.requires_review ? (
                      <span style={{ color: "var(--amber)" }}>review</span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center font-mono text-[11.5px] text-text-faint">
                  no rows match this filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <MethodologyDrawer
        row={active}
        overrides={overrides}
        onClose={() => setActive(null)}
        onOverrideChange={() => router.refresh()}
      />
    </section>
  )
}
