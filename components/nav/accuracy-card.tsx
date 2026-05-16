import type { ReconciliationStats } from "@/lib/nav/reconcile"

function fmtBps(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return `${Math.abs(n).toFixed(digits)} bps`
}

export function AccuracyCard({ stats }: { stats: ReconciliationStats }) {
  const reconciled = stats.positions_reconciled
  if (reconciled === 0) {
    return (
      <section
        className="rounded-md border px-5 py-4 font-mono text-[11.5px] text-text-faint"
        style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
      >
        model accuracy · {stats.methodology_version} ·{" "}
        <span>
          no reconciled periods yet. As fresh filings land, the runner will
          compute model-vs-reported drift in bps and surface it here.
        </span>
      </section>
    )
  }
  const meanColor =
    (stats.mean_abs_drift_bps ?? 0) > 500
      ? "var(--red)"
      : (stats.mean_abs_drift_bps ?? 0) > 250
        ? "var(--amber)"
        : "var(--green)"
  return (
    <section
      className="rounded-md border px-5 py-4"
      style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
            model accuracy · {stats.methodology_version}
          </div>
          <div className="mt-0.5 font-serif text-[15px] italic leading-tight text-text-dim">
            Trailing drift of modeled marks vs reported fair values at the last
            quarter close. Lower is better; &lt;250 bps clears the v1 bar.
          </div>
        </div>
        <span
          className="rounded-[5px] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]"
          style={{
            background: stats.within_quality_bar
              ? "var(--green-bg)"
              : "var(--amber-bg)",
            color: stats.within_quality_bar ? "var(--green)" : "var(--amber)",
          }}
        >
          {stats.within_quality_bar ? "within bar" : "above bar"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="positions reconciled" value={String(reconciled)} />
        <Stat label="latest period" value={stats.latest_period_end ?? "—"} />
        <Stat
          label="mean |drift|"
          value={fmtBps(stats.mean_abs_drift_bps, 0)}
          valueColor={meanColor}
        />
        <Stat label="p95 |drift|" value={fmtBps(stats.p95_abs_drift_bps, 0)} />
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ borderColor: "var(--line)", background: "var(--bg)" }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
        {label}
      </div>
      <div
        className="mt-0.5 font-mono text-[14px] tabular-nums"
        style={{ color: valueColor ?? "var(--text)" }}
      >
        {value}
      </div>
    </div>
  )
}
