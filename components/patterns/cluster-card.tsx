import Link from "next/link"
import type { ClusterCard } from "@/lib/patterns/queries"

const TONE_BORDER: Record<ClusterCard["tone"], string> = {
  crit: "var(--red)",
  warn: "var(--amber)",
  info: "var(--accent)",
}

const TONE_BIG: Record<ClusterCard["tone"], string> = {
  crit: "var(--red)",
  warn: "var(--amber)",
  info: "var(--text)",
}

const PILL_TONE: Record<string, { bg: string; color: string }> = {
  crit: { bg: "var(--red-bg)", color: "var(--red)" },
  warn: { bg: "var(--amber-bg)", color: "var(--amber)" },
  info: { bg: "var(--accent-soft)", color: "var(--accent)" },
  gs: { bg: "var(--gs-bg)", color: "var(--gs)" },
  neutral: { bg: "var(--bg-2)", color: "var(--text-dim)" },
}

function pillToneForTag(tag: string): keyof typeof PILL_TONE {
  const t = tag.toLowerCase()
  if (t.includes("goldman") || t.includes("★")) return "gs"
  if (t.includes("non-accrual") || t.includes("credit cluster") || t.includes("non accrual")) return "warn"
  if (t.includes("litigation")) return "crit"
  if (t.includes("sponsor") || t.includes("cross-fund") || t.includes("cross-borrower") || t.includes("composer")) return "info"
  return "neutral"
}

export function ClusterCardView({ card }: { card: ClusterCard }) {
  return (
    <article
      className="mb-4 overflow-hidden rounded-[10px] border border-l-[3px]"
      style={{
        background: "var(--bg-1)",
        borderColor: "var(--line)",
        borderLeftColor: TONE_BORDER[card.tone],
      }}
    >
      <header
        className="flex items-start justify-between gap-4 border-b px-[18px] py-[14px]"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="min-w-0">
          <div className="mb-1 text-[15px] font-medium leading-snug text-text">
            {card.title}
          </div>
          <div className="font-mono text-[11px] text-text-faint">
            {card.rows.length} borrowers shown ·{" "}
            {card.rows.filter((r) => r.goldman_held).length} Goldman-held
          </div>
          <div className="mt-1 flex flex-wrap gap-[6px]">
            {card.tags.map((t) => {
              const tone = pillToneForTag(t)
              const style = PILL_TONE[tone]
              return (
                <span
                  key={t}
                  className="rounded-[3px] px-[6px] py-[2px] font-mono text-[10px]"
                  style={{
                    background: style.bg,
                    color: style.color,
                  }}
                >
                  {t}
                </span>
              )
            })}
          </div>
        </div>
        <div className="text-right font-mono text-[10.5px] text-text-faint">
          <div
            className="text-[18px] font-semibold leading-none"
            style={{ color: TONE_BIG[card.tone] }}
          >
            {card.meta_value}
          </div>
          <div className="mt-1">{card.meta_label}</div>
          <div className="mt-2 text-text-dim">{card.meta_sub}</div>
        </div>
      </header>

      <p
        className="border-b px-[18px] py-[14px] font-serif text-[13.5px] leading-[1.6] text-text-dim"
        style={{ background: "var(--bg-2)", borderColor: "var(--line)" }}
      >
        {card.thesis}
      </p>

      <div className="py-2">
        <div
          className="grid grid-cols-[1.4fr_60px_60px_60px_80px_36px] gap-[14px] border-b px-[18px] py-[4px] font-mono text-[9.5px] uppercase tracking-[1px] text-text-faint"
          style={{ background: "var(--bg-2)", borderColor: "var(--line)" }}
        >
          <div>borrower</div>
          <div className="text-center">sev</div>
          <div className="text-center">litig</div>
          <div className="text-center">mgmt</div>
          <div className="text-center">FV</div>
          <div />
        </div>
        {card.rows.map((r) => (
          <Link
            key={r.borrower}
            href={`/borrower/${encodeURIComponent(r.borrower)}`}
            className="grid grid-cols-[1.4fr_60px_60px_60px_80px_36px] items-center gap-[14px] border-b px-[18px] py-[10px] text-[13px] no-underline transition-colors hover:bg-bg-2"
            style={{
              borderColor: "var(--line)",
              background: r.goldman_held ? "rgba(138,111,29,0.05)" : undefined,
            }}
          >
            <div>
              <div
                className="font-medium"
                style={{ color: r.goldman_held ? "var(--gs)" : "var(--text)" }}
              >
                {r.borrower}
              </div>
              <div className="mt-[2px] font-mono text-[10px] text-text-faint">
                <span style={{ color: r.goldman_held ? "var(--gs)" : "var(--text-dim)" }}>
                  {r.fund_tickers
                    .map((t) => `${t}${["GSCR", "GSBD"].includes(t) ? " ★" : ""}`)
                    .join(" ") || "—"}
                </span>
                {r.sponsor ? ` · ${r.sponsor}` : ""}
                {r.industry ? ` · ${r.industry}` : ""}
                {r.any_non_accrual ? (
                  <span style={{ color: "var(--red)" }}> · NA</span>
                ) : null}
                {r.is_pik ? <span style={{ color: "var(--amber)" }}> · PIK</span> : null}
              </div>
            </div>
            <div
              className="text-center font-mono text-[11px]"
              style={{
                color:
                  r.max_severity >= 70
                    ? "var(--red)"
                    : r.max_severity >= 40
                    ? "var(--amber)"
                    : "var(--text-dim)",
              }}
            >
              {r.max_severity}
            </div>
            <div className="text-center font-mono text-[11px]" style={{ color: r.n_litigation > 0 ? "var(--red)" : "var(--text-faint)" }}>
              {r.n_litigation}
            </div>
            <div className="text-center font-mono text-[11px]" style={{ color: r.n_mgmt > 0 ? "var(--amber)" : "var(--text-faint)" }}>
              {r.n_mgmt}
            </div>
            <div className="text-center font-mono text-[11px] text-text-dim">
              {r.fv_dollars && r.fv_dollars > 0
                ? `$${(r.fv_dollars / 1_000_000).toFixed(1)}M`
                : "—"}
            </div>
            <div className="text-center text-text-faint">→</div>
          </Link>
        ))}
        {card.rows.length === 0 ? (
          <div className="px-[18px] py-4 text-center font-serif italic text-text-dim">
            No borrowers in this cluster yet.
          </div>
        ) : null}
      </div>

      <footer
        className="flex flex-wrap items-center justify-between gap-3 px-[18px] py-[12px] text-[11.5px]"
        style={{ borderTop: "0.5px solid var(--line)" }}
      >
        <div className="text-text-dim">{card.action_left}</div>
        <div className="text-text-faint font-mono text-[10.5px]">
          methodology: detector_hits × enrichments · 270d forward window
        </div>
      </footer>
    </article>
  )
}
