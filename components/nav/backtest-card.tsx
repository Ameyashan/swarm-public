import type { BacktestRunRow } from "@/lib/nav/queries"

function fmtBps(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return `${Math.abs(n).toFixed(0)} bps`
}

export function BacktestCard({
  runs,
}: {
  runs: BacktestRunRow[]
}) {
  if (runs.length === 0) {
    return (
      <section
        className="rounded-md border px-5 py-4 font-mono text-[11.5px] text-text-faint"
        style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
      >
        backtest · no runs yet. Trigger{" "}
        <code className="text-text">/api/nav/backtest?secret=&hellip;&amp;tune=1</code>{" "}
        to replay against historical observations.
      </section>
    )
  }
  const latest = runs[0]
  const versions = Array.from(new Set(runs.map((r) => r.methodology_version)))
  return (
    <section
      className="rounded-md border px-5 py-4"
      style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
            backtest · {latest.methodology_version} · {latest.fund_ticker} · {latest.start_period} → {latest.end_period}
          </div>
          <div className="mt-0.5 font-serif text-[15px] italic leading-tight text-text-dim">
            Replay against historical observations. {latest.positions_evaluated} positions ·{" "}
            {latest.quarter_pairs_evaluated} quarter pairs.
          </div>
        </div>
        {versions.length > 1 ? (
          <span
            className="rounded-[5px] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]"
            style={{ background: "var(--gs-bg)", color: "var(--gs)" }}
          >
            {versions.length} versions
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="mean |drift|" value={fmtBps(latest.mean_abs_drift_bps)} />
        <Stat label="median |drift|" value={fmtBps(latest.median_abs_drift_bps)} />
        <Stat label="p95 |drift|" value={fmtBps(latest.p95_abs_drift_bps)} />
      </div>

      {runs.length > 1 ? (
        <table className="mt-3 w-full text-[12px]">
          <thead>
            <tr style={{ color: "var(--text-faint)" }}>
              <th className="text-left font-mono font-normal">version</th>
              <th className="text-left font-mono font-normal">fund</th>
              <th className="text-right font-mono font-normal">mean</th>
              <th className="text-right font-mono font-normal">median</th>
              <th className="text-right font-mono font-normal">p95</th>
              <th className="text-right font-mono font-normal">pairs</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 6).map((r) => (
              <tr key={r.id} style={{ borderTop: "0.5px solid var(--line)" }}>
                <td className="py-1 font-mono">{r.methodology_version}</td>
                <td className="py-1 font-mono">{r.fund_ticker}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmtBps(r.mean_abs_drift_bps)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmtBps(r.median_abs_drift_bps)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{fmtBps(r.p95_abs_drift_bps)}</td>
                <td className="py-1 text-right font-mono tabular-nums">{r.quarter_pairs_evaluated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ borderColor: "var(--line)", background: "var(--bg)" }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] tabular-nums">{value}</div>
    </div>
  )
}
