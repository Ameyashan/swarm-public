import type { SignalRow } from "@/lib/briefing/derive"

const ICONS: Record<SignalRow["iconKind"], string> = {
  litigation: "⚖",
  management: "⌥",
  news: "★",
  fallback: "◆",
}

// Icon background / border / glyph color per kind. Strict palette:
//   litigation → red (brick)        — risk-of-loss event class
//   management → amber (mustard)    — watch event class
//   news       → gs (Goldman gold)  — ★ glyph belongs to gold semantic
//   fallback   → accent (terracotta) — editorial fallback row
const ICON_STYLE: Record<
  SignalRow["iconKind"],
  { bg: string; color: string; border: string }
> = {
  litigation: { bg: "var(--red-bg)", color: "var(--red)", border: "var(--red)" },
  management: { bg: "var(--amber-bg)", color: "var(--amber)", border: "var(--amber)" },
  news: { bg: "var(--gs-bg)", color: "var(--gs)", border: "var(--gs)" },
  fallback: { bg: "var(--accent-soft)", color: "var(--accent)", border: "var(--accent)" },
}

const IMPACT_STYLE: Record<
  SignalRow["impact"],
  { bg: string; color: string; border: string; label: string }
> = {
  "credit-negative": {
    bg: "var(--red-bg)",
    color: "var(--red)",
    border: "var(--red)",
    label: "credit negative",
  },
  "credit-positive": {
    bg: "var(--green-bg)",
    color: "var(--green)",
    border: "var(--green)",
    label: "credit positive",
  },
  watch: {
    bg: "var(--amber-bg)",
    color: "var(--amber)",
    border: "var(--amber)",
    label: "watch",
  },
}

export type BacktestStat = {
  hitRatePct: number
  baselinePct: number | null
  lift: number | null
  nEvents: number
  baselineN: number | null
  isLive: boolean
}

function fmtDateMeta(date: string | null, daysAgo: number | null) {
  if (!date) return "date unknown"
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return date
  const formatted = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return daysAgo !== null ? `${formatted} · ${daysAgo}d ago` : formatted
}

function safeHost(url: string | null) {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function BacktestPanel({
  signal,
  stat,
}: {
  signal: SignalRow
  stat: BacktestStat | null
}) {
  if (!stat) return null
  if (signal.iconKind === "fallback") return null

  const liftPretty =
    stat.lift && Number.isFinite(stat.lift)
      ? `${stat.lift.toFixed(1)}× baseline`
      : "lift n/a"
  const baselineLine =
    stat.baselinePct !== null
      ? `Baseline rate across ${stat.baselineN ?? "—"} borrower-quarter observations is ${stat.baselinePct.toFixed(
          1,
        )}%.`
      : "Baseline rate not available in this snapshot — treat the headline rate as a methodology benchmark."

  return (
    <div
      className="mt-3 rounded-md border px-4 py-3"
      style={{ background: "var(--bg-2)", borderColor: "var(--line)" }}
    >
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-faint">
        ⊙ what usually follows · backtest n={stat.nEvents}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[24px] font-medium text-red">
          {stat.hitRatePct.toFixed(1)}%
        </span>
        <span className="font-serif text-[13px] italic text-text-dim">
          of borrower {signal.iconKind} events were followed by a mark-drift
          detector hit within 9 months
        </span>
        <span
          className="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
          style={{
            background: "var(--red-bg)",
            borderColor: "var(--red)",
            color: "var(--red)",
          }}
        >
          {liftPretty}
        </span>
      </div>
      <p className="mt-2 font-serif text-[12.5px] leading-relaxed text-text-dim">
        {baselineLine}{" "}
        {stat.isLive
          ? "Computed live from detector_hits + enrichments."
          : "Lift is the strongest single predictive pattern observed in our backtest."}
      </p>
    </div>
  )
}

export function ForwardSignals({
  signals,
  backtest,
}: {
  signals: SignalRow[]
  backtest: BacktestStat | null
}) {
  return (
    <section
      aria-label="Forward signals"
      className="rounded-[10px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <header
        className="flex flex-col gap-1 border-b px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="flex items-center gap-2">
          <span className="pulse-dot" aria-hidden />
          <span className="font-mono text-[11.5px] uppercase tracking-wider text-text">
            Forward signals · live enrichments
          </span>
        </div>
        <span className="font-serif text-[13px] italic text-text-dim">
          Leading indicators on your positions — non-mark events the next
          filing will probably reflect.
        </span>
      </header>

      {signals.length === 0 ? (
        <div className="p-6 text-center font-serif text-[14px] italic text-text-dim">
          No enriched signals on GSCR or GSBD in the recent window.
        </div>
      ) : (
        <ul>
          {signals.map((s, idx) => {
            const impact = IMPACT_STYLE[s.impact]
            const iconStyle = ICON_STYLE[s.iconKind]
            const host = safeHost(s.sourceUrl)
            return (
              <li
                key={s.id}
                className="grid gap-4 px-5 py-4 sm:grid-cols-[44px_140px_1fr_180px]"
                style={{
                  borderTop:
                    idx === 0 ? "none" : "0.5px solid var(--line)",
                }}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-md border text-base"
                  style={{
                    background: iconStyle.bg,
                    color: iconStyle.color,
                    borderColor: iconStyle.border,
                  }}
                  aria-hidden
                >
                  {ICONS[s.iconKind]}
                </div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-text-faint">
                  <div>{fmtDateMeta(s.date, s.daysAgo)}</div>
                  <div className="mt-1 text-text-dim">{s.typeLabel}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] leading-snug text-text">
                    {s.fund ? (
                      <span className="mr-2 font-mono text-[12px] font-medium text-gs">
                        {s.fund}
                      </span>
                    ) : null}
                    <span className="font-semibold">{s.company}</span>
                    <span className="text-text-dim"> — </span>
                    <span>{s.headline}</span>
                  </div>
                  <p className="mt-1 font-serif text-[13px] leading-[1.6] text-text-dim">
                    {s.summary}
                  </p>
                  <div className="mt-1 font-mono text-[10.5px] text-text-faint">
                    {s.sourceUrl ? (
                      <>
                        source:{" "}
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                        >
                          {s.sourceLabel ?? host ?? "link"}
                        </a>
                      </>
                    ) : (
                      <>{s.sourceLabel ? `source: ${s.sourceLabel}` : "no public source link"}</>
                    )}
                  </div>
                  <BacktestPanel signal={s} stat={backtest} />
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <span
                    className="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                    style={{
                      background: impact.bg,
                      color: impact.color,
                      borderColor: impact.border,
                    }}
                  >
                    {impact.label}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
