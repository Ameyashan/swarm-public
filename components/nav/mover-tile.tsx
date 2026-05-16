// Header summary tiles for the /nav page. Pure presentation.

import type { DailyMarksSummary } from "@/lib/nav/queries"

function fmtDollars(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0"
  const v = Math.abs(n)
  const sign = n < 0 ? "−" : ""
  if (v >= 1_000_000_000) return `${sign}$${(v / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${sign}$${(v / 1_000).toFixed(0)}K`
  return `${sign}$${v.toFixed(0)}`
}

function deltaColor(delta: number): string {
  if (delta > 0) return "var(--green)"
  if (delta < 0) return "var(--red)"
  return "var(--text-dim)"
}

export function MoverTiles({
  summary,
  methodologyVersion,
}: {
  summary: DailyMarksSummary
  methodologyVersion: string | null
}) {
  const deltaPct =
    summary.total_fv_dollars > 0
      ? (summary.total_delta_dollars / summary.total_fv_dollars) * 100
      : 0
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Tile
        label="positions marked"
        value={summary.position_count.toLocaleString()}
        sub={summary.mark_date ?? "no marks yet"}
      />
      <Tile
        label="total fair value"
        value={summary.total_fv_dollars > 0 ? fmtDollars(summary.total_fv_dollars) : "—"}
        sub="sum across marks"
      />
      <Tile
        label="today’s Δ"
        value={fmtDollars(summary.total_delta_dollars)}
        sub={`${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%`}
        valueColor={deltaColor(summary.total_delta_dollars)}
      />
      <Tile
        label="movers"
        value={`${summary.movers_up} ↑ · ${summary.movers_down} ↓`}
        sub="vs prior mark"
      />
      <Tile
        label="review queue"
        value={String(summary.review_count)}
        sub={methodologyVersion ? `methodology ${methodologyVersion}` : "—"}
        valueColor={summary.review_count > 0 ? "var(--amber)" : undefined}
      />
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string
  value: string
  sub?: string
  valueColor?: string
}) {
  return (
    <div
      className="rounded-md border px-4 py-3"
      style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
    >
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
        {label}
      </div>
      <div
        className="mt-1 font-serif text-[22px] leading-tight"
        style={{ color: valueColor ?? "var(--text)" }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-[2px] font-mono text-[10.5px] text-text-dim">{sub}</div>
      )}
    </div>
  )
}
