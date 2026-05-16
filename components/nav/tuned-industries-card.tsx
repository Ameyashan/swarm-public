import type { TunedIndustryRow } from "@/lib/nav/queries"

function fmtBps(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return `${Math.abs(n).toFixed(digits)} bps`
}

function deltaColor(d: number | null | undefined): string {
  if (d === null || d === undefined || d === 0) return "var(--text-faint)"
  if (d <= -30) return "var(--green)"
  if (d <= -10) return "var(--amber)"
  return "var(--text-dim)"
}

export function TunedIndustriesCard({
  rows,
  methodologyVersion,
}: {
  rows: TunedIndustryRow[]
  methodologyVersion: string
}) {
  if (rows.length === 0) {
    return (
      <section
        className="rounded-md border px-5 py-4 font-mono text-[11.5px] text-text-faint"
        style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
      >
        per-industry overrides · no rows for {methodologyVersion}. Run{" "}
        <code className="text-text">/api/nav/backtest?tune=1</code> to populate.
      </section>
    )
  }
  const realImprovements = rows.filter(
    (r) => (r.tuned_minus_baseline_bps ?? 0) < 0,
  ).length
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
            per-industry overrides · {methodologyVersion}
          </div>
          <div className="mt-0.5 font-serif text-[14px] italic text-text-dim">
            {realImprovements} of {rows.length} industries beat the v1.0.0
            defaults. Zero-delta rows kept the defaults — the tuner stored them
            but they produce identical marks.
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead style={{ background: "var(--bg-2)" }}>
            <tr style={{ borderBottom: "0.5px solid var(--line)" }}>
              <Th label="industry" align="left" />
              <Th label="n" align="right" />
              <Th label="tuned" align="right" />
              <Th label="Δ vs baseline" align="right" />
              <Th label="w_hy" align="right" />
              <Th label="w_ll" align="right" />
              <Th label="w_sec" align="right" />
              <Th label="dur" align="right" />
              <Th label="α" align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.tuned_minus_baseline_bps ?? 0
              const noChange = delta === 0
              return (
                <tr
                  key={r.industry}
                  style={{
                    borderTop: "0.5px solid var(--line)",
                    opacity: noChange ? 0.55 : 1,
                  }}
                >
                  <td className="px-3 py-2 font-serif text-[13px] text-text capitalize">
                    {r.industry}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-text-dim">
                    {r.sample_size ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmtBps(r.fit_mean_abs_drift_bps, 0)}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono tabular-nums font-medium"
                    style={{ color: deltaColor(delta) }}
                  >
                    {delta === 0
                      ? "—"
                      : `${delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(0)} bps`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-text-dim">
                    {r.w_hy.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-text-dim">
                    {r.w_ll.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-text-dim">
                    {r.w_sec.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-text-dim">
                    {Number(r.duration_years).toFixed(1)}y
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-text-dim">
                    {Number(r.alpha_dcf).toFixed(2)}
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

function Th({ label, align }: { label: string; align: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] ${align === "right" ? "text-right" : "text-left"}`}
      style={{ color: "var(--text-faint)" }}
    >
      {label}
    </th>
  )
}
