import type { DailyMarkRow } from "@/lib/nav/queries"

function reviewReason(r: DailyMarkRow): string {
  const rails = (r.components?.rails_fired ?? {}) as Record<string, boolean>
  const reasons: string[] = []
  if (rails.daily_clamp_floor) reasons.push("daily floor clamped")
  if (rails.daily_clamp_ceiling) reasons.push("daily ceiling clamped")
  if (rails.drift_vs_anchor) reasons.push("> 10% drift vs anchor")
  const idio = Number(r.components?.idio_shock_pct ?? 0)
  if (idio !== 0) reasons.push(`idio shock ${(idio * 100).toFixed(1)}%`)
  return reasons.join(" · ") || "—"
}

export function ReviewQueue({ rows }: { rows: DailyMarkRow[] }) {
  const flagged = rows.filter((r) => r.requires_review)
  if (flagged.length === 0) {
    return (
      <section
        className="rounded-md border px-4 py-3 font-mono text-[11.5px] text-text-faint"
        style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
      >
        review queue empty — no rail clamps or idio overlays fired today
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
        review queue · {flagged.length}
      </h3>
      <ul className="flex flex-col gap-1">
        {flagged.map((r) => (
          <li
            key={r.id}
            className="rounded-md border px-3 py-2 font-mono text-[12px]"
            style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-serif text-[13.5px] text-text">
                {r.portfolio_company_canonical}
              </span>
              <span className="text-text-faint">{r.fund_ticker} · {r.mark_date}</span>
            </div>
            <div className="mt-[2px] text-text-dim">{reviewReason(r)}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}
