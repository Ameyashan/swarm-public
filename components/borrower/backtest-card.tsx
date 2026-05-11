import type { BorrowerBacktest } from "@/lib/borrower/queries"

function statColor(pct: number | null, kind: "lit" | "mgmt" | "news"): string {
  if (pct === null) return "var(--text-dim)"
  if (kind === "lit") return pct >= 30 ? "var(--red)" : "var(--amber)"
  if (kind === "mgmt") return pct >= 30 ? "var(--amber)" : "var(--text-dim)"
  return "var(--accent)"
}

export function BacktestCard({ backtest }: { backtest: BorrowerBacktest | null }) {
  if (!backtest) {
    return (
      <section
        className="rounded-[10px] border px-5 py-5"
        style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          ⊙ reverse backtest
        </div>
        <p className="mt-2 font-serif text-[13px] italic leading-[1.55] text-text-dim">
          Backtest unavailable — not enough cross-fund spread events in the current detector slice
          to compute a stable rate.
        </p>
      </section>
    )
  }
  const n = backtest.n_spread_events
  return (
    <section
      className="rounded-[10px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <div className="border-b px-5 py-3" style={{ borderColor: "var(--line)" }}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          ⊙ reverse backtest · what typically precedes a 1pp+ spread
        </div>
        <div className="mt-1 font-serif text-[15px] leading-[1.35] text-text">
          Across {n.toLocaleString()} cross-fund spread event{n === 1 ? "" : "s"} ≥ 1pp in the live
          dataset
        </div>
      </div>
      <div className="px-5 py-4">
        {n === 0 ? (
          <p className="font-serif text-[13px] italic leading-[1.55] text-text-dim">
            No spreads ≥ 1pp present in the current slice.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Row
              pct={backtest.pct_with_litigation_prior}
              count={backtest.n_with_litigation_prior}
              n={n}
              kind="lit"
              label="were preceded by a litigation event in the prior 6 months"
            />
            <Row
              pct={backtest.pct_with_management_prior}
              count={backtest.n_with_management_prior}
              n={n}
              kind="mgmt"
              label="were preceded by a management change in the prior 6 months"
            />
            <Row
              pct={backtest.pct_with_news_prior}
              count={backtest.n_with_news_prior}
              n={n}
              kind="news"
              label="were preceded by adverse news / workforce signal in the prior 6 months"
            />
          </div>
        )}
        <p className="mt-4 border-t pt-3 font-serif text-[12px] italic leading-[1.55] text-text-dim" style={{ borderColor: "var(--line)" }}>
          {backtest.methodology_note}
        </p>
      </div>
    </section>
  )
}

function Row({
  pct,
  count,
  n,
  kind,
  label,
}: {
  pct: number | null
  count: number
  n: number
  kind: "lit" | "mgmt" | "news"
  label: string
}) {
  const color = statColor(pct, kind)
  const filledFrac = pct === null ? 0 : Math.max(0, Math.min(1, pct / 100))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[22px] font-medium tabular-nums" style={{ color }}>
          {pct === null ? "—" : `${pct}%`}
        </span>
        <span className="font-serif text-[13px] leading-[1.5] text-text-dim">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--bg-2)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${(filledFrac * 100).toFixed(0)}%`, background: color, opacity: 0.85 }}
          />
        </div>
        <span className="font-mono text-[10.5px] text-text-faint">
          {count} / {n}
        </span>
      </div>
    </div>
  )
}
