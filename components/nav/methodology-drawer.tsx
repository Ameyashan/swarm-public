"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { DailyMarkRow, MarkOverrideRow } from "@/lib/nav/queries"

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
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function MethodologyDrawer({
  row,
  overrides,
  onClose,
  onOverrideChange,
}: {
  row: DailyMarkRow | null
  overrides: MarkOverrideRow[]
  onClose: () => void
  onOverrideChange?: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    if (row) document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [row, onClose])

  const rowOverrides = useMemo(() => {
    if (!row) return []
    return overrides.filter(
      (o) =>
        o.fund_ticker === row.fund_ticker &&
        o.portfolio_company_canonical === row.portfolio_company_canonical &&
        o.override_date === row.mark_date,
    )
  }, [overrides, row])

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

        <OverridesSection
          row={row}
          existing={rowOverrides}
          onChange={onOverrideChange}
        />

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

// ─────────────────────────────────────────────────────────────────────────────
// Overrides — list existing + submit form. Audit-only; never mutates daily_marks.
// ─────────────────────────────────────────────────────────────────────────────

function statusBadge(status: MarkOverrideRow["status"]): { bg: string; fg: string } {
  if (status === "approved") return { bg: "var(--green-bg)", fg: "var(--green)" }
  if (status === "rejected") return { bg: "var(--red-bg)", fg: "var(--red)" }
  return { bg: "var(--amber-bg)", fg: "var(--amber)" }
}

function OverridesSection({
  row,
  existing,
  onChange,
}: {
  row: DailyMarkRow
  existing: MarkOverrideRow[]
  onChange?: () => void
}) {
  return (
    <section
      className="rounded-md border p-3"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
          overrides · {existing.length}
        </div>
        <div className="font-mono text-[10px] text-text-faint">
          audit-only · never mutates the source
        </div>
      </div>

      {existing.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {existing.map((o) => (
            <OverrideRow key={o.id} o={o} onChange={onChange} />
          ))}
        </ul>
      )}

      <OverrideForm row={row} onSubmitted={onChange} />
    </section>
  )
}

function OverrideRow({
  o,
  onChange,
}: {
  o: MarkOverrideRow
  onChange?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const badge = statusBadge(o.status)

  async function patch(status: "approved" | "rejected") {
    const approver = window.prompt(`${status === "approved" ? "Approve" : "Reject"} as (your name)?`)
    if (!approver || approver.trim().length < 2) return
    setBusy(true)
    try {
      const res = await fetch("/api/nav/overrides", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: o.id, status, approver: approver.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast.success(`override ${status}`)
      onChange?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      className="rounded-md border p-2 font-mono text-[11px]"
      style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="tabular-nums">
          {Number(o.original_mark).toFixed(1)} → <span className="font-medium">{Number(o.override_mark).toFixed(1)}</span>
        </span>
        <span
          className="rounded-[3px] px-[6px] py-[2px] text-[10px] uppercase"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {o.status}
        </span>
      </div>
      <div className="mt-1 text-text-dim">{o.reason}</div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-text-faint">
        <span>{o.approver ?? "—"} · {new Date(o.created_at).toLocaleString()}</span>
        {o.status === "pending" ? (
          <span className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => patch("approved")}
              className="rounded-[3px] px-2 py-[2px] text-[10px] uppercase"
              style={{ background: "var(--green-bg)", color: "var(--green)" }}
            >
              approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => patch("rejected")}
              className="rounded-[3px] px-2 py-[2px] text-[10px] uppercase"
              style={{ background: "var(--red-bg)", color: "var(--red)" }}
            >
              reject
            </button>
          </span>
        ) : null}
      </div>
    </li>
  )
}

function OverrideForm({
  row,
  onSubmitted,
}: {
  row: DailyMarkRow
  onSubmitted?: () => void
}) {
  const original = row.mark_pct ?? null
  const [overrideMark, setOverrideMark] = useState<string>(
    original !== null ? original.toFixed(1) : "",
  )
  const [reason, setReason] = useState("")
  const [approver, setApprover] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const om = Number(overrideMark)
    if (!Number.isFinite(om)) {
      toast.error("override mark must be a number")
      return
    }
    if (original === null) {
      toast.error("model mark has no mark_pct — cost is missing upstream")
      return
    }
    if (reason.trim().length < 5) {
      toast.error("reason required (min 5 chars)")
      return
    }
    if (approver.trim().length < 2) {
      toast.error("approver required")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/nav/overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fund_ticker: row.fund_ticker,
          portfolio_company_canonical: row.portfolio_company_canonical,
          override_date: row.mark_date,
          original_mark: original,
          override_mark: om,
          reason: reason.trim(),
          approver: approver.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast.success("override submitted")
      setReason("")
      onSubmitted?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 text-[12px]">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
            override mark %
          </span>
          <input
            type="number"
            step="0.1"
            value={overrideMark}
            onChange={(e) => setOverrideMark(e.target.value)}
            className="rounded-[5px] border px-2 py-1 font-mono tabular-nums"
            style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
            approver
          </span>
          <input
            type="text"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="your name"
            className="rounded-[5px] border px-2 py-1 font-mono"
            style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
          reason
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="why is the model wrong here?"
          className="rounded-[5px] border px-2 py-1 font-serif"
          style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="self-end rounded-[5px] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em]"
        style={{ background: "var(--gs)", color: "var(--bg)" }}
      >
        {busy ? "submitting…" : "submit override"}
      </button>
    </form>
  )
}
