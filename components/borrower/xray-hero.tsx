import type { BorrowerMeta } from "@/lib/borrower/queries"

function fmtFv(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function quarterLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${q}Q ’${yy}`
}

function Pill({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode
  variant?: "neutral" | "gs" | "warn" | "crit" | "ok"
}) {
  const styles: Record<string, { bg: string; fg: string; border: string }> = {
    neutral: { bg: "var(--bg-2)", fg: "var(--text-dim)", border: "var(--line)" },
    gs: { bg: "var(--gs-bg)", fg: "var(--gs)", border: "var(--gs)" },
    warn: { bg: "var(--amber-bg)", fg: "var(--amber)", border: "var(--amber)" },
    crit: { bg: "var(--red-bg)", fg: "var(--red)", border: "var(--red)" },
    ok: { bg: "var(--green-bg)", fg: "var(--green)", border: "var(--green)" },
  }
  const s = styles[variant]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-[10px] py-[3px] font-mono text-[10.5px] uppercase tracking-[0.08em]"
      style={{ background: s.bg, color: s.fg, borderColor: s.border }}
    >
      {children}
    </span>
  )
}

export function XrayHero({
  meta,
  summary,
}: {
  meta: BorrowerMeta
  summary: React.ReactNode
}) {
  const fundsLabel =
    meta.funds_holding.length > 0
      ? `held by ${meta.funds_holding.length} BDC${meta.funds_holding.length === 1 ? "" : "s"}`
      : "no live observations"
  return (
    <section className="flex flex-col gap-4 border-b pb-6" style={{ borderColor: "var(--line)" }}>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
        <a href="/" className="text-text-faint hover:text-text">
          briefing
        </a>
        <span className="mx-2 text-text-faint">/</span>
        <a href="/book" className="text-text-faint hover:text-text">
          position book
        </a>
        <span className="mx-2 text-text-faint">/</span>
        <span className="text-text">borrower x-ray</span>
      </div>
      <h1 className="font-serif text-[36px] font-normal leading-[1.1] tracking-[-0.6px] text-text">
        {meta.canonical_name}
      </h1>
      <div className="flex flex-wrap items-center gap-2">
        {meta.has_goldman && <Pill variant="gs">★ goldman holds</Pill>}
        <Pill variant="neutral">{fundsLabel}</Pill>
        {meta.cross_fund_spread_pp !== null && meta.cross_fund_spread_pp >= 1 && (
          <Pill variant="warn">cross-fund spread {meta.cross_fund_spread_pp.toFixed(1)}pp</Pill>
        )}
        {meta.cross_fund_spread_pp !== null &&
          meta.cross_fund_spread_pp > 0 &&
          meta.cross_fund_spread_pp < 1 && (
            <Pill variant="neutral">cross-fund spread {meta.cross_fund_spread_pp.toFixed(1)}pp</Pill>
          )}
        {meta.sponsor && <Pill variant="neutral">{meta.sponsor.toLowerCase()} · sponsor</Pill>}
        {meta.industry && <Pill variant="neutral">{meta.industry.toLowerCase()}</Pill>}
        {meta.any_non_accrual && <Pill variant="crit">non-accrual</Pill>}
        {!meta.any_non_accrual && meta.any_pik && <Pill variant="warn">PIK</Pill>}
        {meta.has_critical_hit && <Pill variant="crit">critical signal</Pill>}
        {meta.latest_period && (
          <Pill variant="neutral">latest · {quarterLabel(meta.latest_period) ?? meta.latest_period}</Pill>
        )}
      </div>
      <div className="max-w-[820px] font-serif text-[16px] italic leading-[1.65] text-text-dim">
        {summary}
      </div>
      <div className="flex flex-wrap gap-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-faint">
        {meta.worst_mark && meta.worst_mark.mark_pct !== null && (
          <span>
            worst mark <span className="text-red">{meta.worst_mark.mark_pct.toFixed(1)}%</span> ·{" "}
            <span className="text-text-dim normal-case tracking-normal">{meta.worst_mark.fund_ticker}</span>
          </span>
        )}
        {meta.best_mark && meta.best_mark.mark_pct !== null && (
          <span>
            best mark <span className="text-green">{meta.best_mark.mark_pct.toFixed(1)}%</span> ·{" "}
            <span className="text-text-dim normal-case tracking-normal">{meta.best_mark.fund_ticker}</span>
          </span>
        )}
        {meta.peer_median_mark_pct !== null && (
          <span>
            peer median <span className="text-text">{meta.peer_median_mark_pct.toFixed(1)}%</span>
          </span>
        )}
        <span>
          live hits <span className="text-text">{meta.recent_hit_count}</span>
        </span>
      </div>
    </section>
  )
}

export function fmtFvDollars(n: number): string {
  return fmtFv(n)
}
export { quarterLabel as borrowerQuarterLabel }
