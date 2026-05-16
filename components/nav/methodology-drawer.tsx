"use client"

import { useEffect } from "react"
import type { DailyMarkRow } from "@/lib/nav/queries"

function fmtBps(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}${Math.abs(n).toFixed(1)} bps`
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}${Math.abs(n * 100).toFixed(digits)}%`
}

function fmtNum(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

export function MethodologyDrawer({
  row,
  onClose,
}: {
  row: DailyMarkRow | null
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    if (row) document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [row, onClose])

  if (!row) return null

  const c = (row.components ?? {}) as Record<string, any>
  const trail = (c.benchmark_trail ?? []) as Array<{
    series_code: string
    weight: number
    value_today: number
    value_prior: number
    delta_bps: number
  }>
  const rails = (c.rails_fired ?? {}) as Record<string, boolean>

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        aria-label="close drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
      />
      <aside
        className="relative z-50 flex h-full w-full max-w-[480px] flex-col gap-4 overflow-y-auto border-l p-6 shadow-xl"
        style={{ background: "var(--bg)", borderColor: "var(--line)" }}
      >
        <header>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
            methodology · {row.methodology_version} · {row.mark_date}
          </div>
          <h2 className="mt-1 font-serif text-[22px] leading-tight text-text">
            {row.portfolio_company_canonical}
          </h2>
          <button
            onClick={onClose}
            className="absolute right-4 top-4 font-mono text-[11px] text-text-dim hover:text-text"
          >
            esc ✕
          </button>
        </header>

        <section className="grid grid-cols-2 gap-3">
          <Stat label="prior FV (k)" value={fmtNum(row.prior_fv, 1)} />
          <Stat label="today FV (k)" value={fmtNum(row.fair_value_estimated, 1)} />
          <Stat label="anchor FV (k)" value={fmtNum(c.fv_anchor, 1)} />
          <Stat label="anchor drift" value={fmtPct(c.anchor_drift_pct)} />
        </section>

        <section
          className="rounded-md border p-3"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
            spread delta — triangulation
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px]">
            <span className="text-text-dim">α (DCF weight)</span>
            <span className="text-right tabular-nums">{Number(c.alpha_dcf ?? 0).toFixed(2)}</span>
            <span className="text-text-dim">duration (y)</span>
            <span className="text-right tabular-nums">{Number(c.duration_years ?? 0).toFixed(2)}</span>
            <span className="text-text-dim">pillar A (DCF)</span>
            <span className="text-right tabular-nums">{fmtBps(c.pillar_a_spread_delta_bps)}</span>
            <span className="text-text-dim">pillar B (market)</span>
            <span className="text-right tabular-nums">{fmtBps(c.pillar_b_spread_delta_bps)}</span>
            <span className="text-text">blended</span>
            <span className="text-right font-medium tabular-nums">
              {fmtBps(c.blended_spread_delta_bps)}
            </span>
          </div>
        </section>

        <section
          className="rounded-md border p-3"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
            benchmark inputs
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: "var(--text-faint)" }}>
                <th className="text-left font-mono font-normal">series</th>
                <th className="text-right font-mono font-normal">w</th>
                <th className="text-right font-mono font-normal">prior</th>
                <th className="text-right font-mono font-normal">today</th>
                <th className="text-right font-mono font-normal">Δ bps</th>
              </tr>
            </thead>
            <tbody>
              {trail.map((t) => (
                <tr key={t.series_code} style={{ borderTop: "0.5px solid var(--line)" }}>
                  <td className="py-1 font-mono">{t.series_code}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{t.weight.toFixed(2)}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{fmtNum(t.value_prior, 4)}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{fmtNum(t.value_today, 4)}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{fmtBps(t.delta_bps)}</td>
                </tr>
              ))}
              {trail.length === 0 && (
                <tr><td colSpan={5} className="py-2 text-center text-text-faint">no benchmark snapshots in components</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section
          className="rounded-md border p-3"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
            overlay + rails
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px]">
            <span className="text-text-dim">idio shock</span>
            <span className="text-right tabular-nums" style={{ color: (c.idio_shock_pct ?? 0) !== 0 ? "var(--red)" : "var(--text)" }}>
              {fmtPct(c.idio_shock_pct, 2)}
            </span>
            <span className="text-text-dim">daily floor hit</span>
            <span className="text-right" style={{ color: rails.daily_clamp_floor ? "var(--amber)" : "var(--text-dim)" }}>
              {rails.daily_clamp_floor ? "yes" : "no"}
            </span>
            <span className="text-text-dim">daily ceiling hit</span>
            <span className="text-right" style={{ color: rails.daily_clamp_ceiling ? "var(--amber)" : "var(--text-dim)" }}>
              {rails.daily_clamp_ceiling ? "yes" : "no"}
            </span>
            <span className="text-text-dim">anchor-drift flag</span>
            <span className="text-right" style={{ color: rails.drift_vs_anchor ? "var(--red)" : "var(--text-dim)" }}>
              {rails.drift_vs_anchor ? "yes" : "no"}
            </span>
          </div>
        </section>

        <footer className="font-serif text-[12.5px] leading-snug text-text-dim">
          Decision-support mark. Not a 40-Act fair-value mark.
        </footer>
      </aside>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
        {label}
      </div>
      <div className="mt-[2px] font-mono text-[14px] tabular-nums">{value}</div>
    </div>
  )
}
