import type { BorrowerLatestMark } from "@/lib/borrower/queries"

function quarterLabel(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${q}Q ’${yy}`
}

function fmtFv(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtDelta(pp: number | null): { text: string; variant: "warn" | "crit" | "ok" | "neutral" } {
  if (pp === null) return { text: "—", variant: "neutral" }
  if (Math.abs(pp) < 0.1) return { text: "at median", variant: "neutral" }
  if (pp >= 1) return { text: `+${pp.toFixed(1)}pp above`, variant: "warn" }
  if (pp > 0) return { text: `+${pp.toFixed(1)}pp above`, variant: "warn" }
  if (pp <= -1) return { text: `${pp.toFixed(1)}pp below`, variant: "crit" }
  return { text: `${pp.toFixed(1)}pp below`, variant: "crit" }
}

function deltaStyles(variant: "warn" | "crit" | "ok" | "neutral"): { bg: string; fg: string } {
  switch (variant) {
    case "warn":
      return { bg: "var(--amber-bg)", fg: "var(--amber)" }
    case "crit":
      return { bg: "var(--red-bg)", fg: "var(--red)" }
    case "ok":
      return { bg: "var(--green-bg)", fg: "var(--green)" }
    default:
      return { bg: "var(--bg-2)", fg: "var(--text-dim)" }
  }
}

export function LatestMarksTable({ rows }: { rows: BorrowerLatestMark[] }) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded-[10px] border px-6 py-8 text-center"
        style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          no latest marks
        </div>
        <p className="mt-2 font-serif italic text-text-dim">
          No fund holds an observable position for this borrower.
        </p>
      </div>
    )
  }
  return (
    <section
      className="rounded-[10px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--line)" }}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-dim">
          latest marks · peer-median delta
        </div>
        <div className="font-mono text-[10.5px] text-text-faint">
          {rows.length} fund{rows.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint"
              style={{ borderBottom: "1px solid var(--line)" }}
            >
              <th className="px-5 py-2 text-left">fund</th>
              <th className="px-3 py-2 text-left">period</th>
              <th className="px-3 py-2 text-right">FV</th>
              <th className="px-3 py-2 text-right">cost</th>
              <th className="px-3 py-2 text-right">mark % cost</th>
              <th className="px-3 py-2 text-left">vs peer median</th>
              <th className="px-5 py-2 text-left">accrual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = fmtDelta(r.delta_vs_peer_pp)
              const ds = deltaStyles(delta.variant)
              const isNonAccrual = r.accrual_status === "non_accrual"
              return (
                <tr
                  key={r.fund_ticker}
                  className="transition-colors hover:bg-bg-2"
                  style={{
                    borderBottom: "1px solid var(--line)",
                    background: r.is_goldman ? "var(--gs-bg)" : undefined,
                  }}
                >
                  <td className="px-5 py-3 align-top">
                    <span
                      className="font-mono text-[12px] font-medium"
                      style={{ color: r.is_goldman ? "var(--gs)" : "var(--text)" }}
                    >
                      {r.fund_ticker}
                      {r.is_goldman ? " ★" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top font-mono text-[11px] text-text-dim">
                    {quarterLabel(r.period_end)}
                  </td>
                  <td className="px-3 py-3 align-top text-right font-mono text-[11.5px] tabular-nums text-text">
                    {fmtFv(r.fv_dollars)}
                  </td>
                  <td className="px-3 py-3 align-top text-right font-mono text-[11.5px] tabular-nums text-text">
                    {fmtFv(r.cost_dollars)}
                  </td>
                  <td className="px-3 py-3 align-top text-right font-mono text-[12px] tabular-nums">
                    <span style={{ color: r.is_goldman ? "var(--gs)" : "var(--text)" }}>
                      {r.mark_pct === null ? "—" : `${r.mark_pct.toFixed(1)}%`}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span
                      className="inline-flex items-center rounded-full px-[10px] py-[3px] font-mono text-[10.5px] uppercase tracking-[0.06em]"
                      style={{ background: ds.bg, color: ds.fg }}
                    >
                      {delta.text}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-top">
                    <span
                      className="inline-flex items-center rounded-full px-[10px] py-[3px] font-mono text-[10.5px] uppercase tracking-[0.06em]"
                      style={{
                        background: isNonAccrual ? "var(--red-bg)" : "var(--green-bg)",
                        color: isNonAccrual ? "var(--red)" : "var(--green)",
                      }}
                    >
                      {isNonAccrual ? "non-accrual" : r.accrual_status ?? "accrual"}
                    </span>
                    {r.is_pik && (
                      <span
                        className="ml-2 inline-flex items-center rounded-full px-[10px] py-[3px] font-mono text-[10.5px] uppercase tracking-[0.06em]"
                        style={{ background: "var(--amber-bg)", color: "var(--amber)" }}
                      >
                        PIK
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
