import type { FundBookStats } from "@/lib/book/queries"

function fmtBillions(dollars: number): string {
  if (!Number.isFinite(dollars) || dollars <= 0) return "—"
  const b = dollars / 1_000_000_000
  if (b >= 1) return `$${b.toFixed(2)}B`
  const m = dollars / 1_000_000
  return `$${m.toFixed(1)}M`
}

function fmtMillions(dollars: number): string {
  if (!Number.isFinite(dollars) || dollars <= 0) return "$0M"
  const m = dollars / 1_000_000
  if (m >= 100) return `$${m.toFixed(0)}M`
  return `$${m.toFixed(1)}M`
}

function fmtPct(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(digits)}%`
}

function pikTone(p: number | null): "ok" | "watch" | "crit" {
  if (p === null) return "ok"
  if (p >= 15) return "crit"
  if (p >= 7) return "watch"
  return "ok"
}

export function StatCards({
  stats,
  hitCountTotal,
}: {
  stats: FundBookStats | null
  hitCountTotal: number
}) {
  if (!stats) {
    return (
      <div
        className="rounded-[10px] border px-5 py-4 font-serif italic text-text-dim"
        style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
      >
        Position metrics unavailable for this fund.
      </div>
    )
  }

  const cards = [
    {
      label: "Fair value",
      val: fmtBillions(stats.total_fv_dollars),
      delta: stats.period_end
        ? `${stats.position_count.toLocaleString()} positions · period ${stats.period_end}`
        : "no period data",
      tone: "neutral" as const,
    },
    {
      label: "PIK share",
      val: fmtPct(stats.pik_pct),
      delta: "of total fair value",
      tone: pikTone(stats.pik_pct),
    },
    {
      label: "Non-accrual",
      val:
        stats.na_count > 0
          ? `${stats.na_count} · ${fmtMillions(stats.na_fv_dollars)}`
          : "0",
      delta:
        stats.total_fv_dollars > 0
          ? `${((stats.na_fv_dollars / stats.total_fv_dollars) * 100).toFixed(2)}% of FV`
          : "—",
      tone: stats.na_count > 0 ? ("crit" as const) : ("ok" as const),
    },
    {
      label: "Detector hits · latest period",
      val: String(stats.hit_count),
      delta: `${hitCountTotal.toLocaleString()} flagged borrowers all-time`,
      tone: stats.hit_count > 20 ? ("crit" as const) : stats.hit_count > 0 ? ("watch" as const) : ("ok" as const),
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => {
        const valColor =
          c.tone === "crit"
            ? "var(--red)"
            : c.tone === "watch"
              ? "var(--amber)"
              : c.tone === "ok"
                ? "var(--text)"
                : "var(--text)"
        return (
          <div
            key={c.label}
            className="rounded-[10px] border p-4"
            style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
          >
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-faint">
              {c.label}
            </div>
            <div
              className="mt-2 font-serif text-[26px] leading-[1.1] tracking-[-0.4px]"
              style={{ color: valColor }}
            >
              {c.val}
            </div>
            <div className="mt-1.5 font-mono text-[10.5px] text-text-dim">
              {c.delta}
            </div>
          </div>
        )
      })}
    </div>
  )
}
