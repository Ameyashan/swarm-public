import type { SignalRow } from "@/lib/briefing/derive"

const ICONS: Record<SignalRow["iconKind"], string> = {
  litigation: "⚖",
  management: "⌥",
  news: "★",
  fallback: "◆",
}

const ICON_STYLE: Record<SignalRow["iconKind"], string> = {
  litigation: "bg-brick-red-soft text-brick-red border-brick-red/40",
  management: "bg-mustard-soft text-mustard border-mustard/40",
  news: "bg-gs-gold-soft text-gs-gold border-gs-gold/40",
  fallback: "bg-terracotta-soft text-terracotta border-terracotta/40",
}

const IMPACT_STYLE: Record<SignalRow["impact"], { bg: string; text: string; label: string }> = {
  "credit-negative": {
    bg: "bg-brick-red-soft border-brick-red/40",
    text: "text-brick-red",
    label: "credit negative",
  },
  "credit-positive": {
    bg: "bg-sage-soft border-sage/40",
    text: "text-sage",
    label: "credit positive",
  },
  watch: {
    bg: "bg-mustard-soft border-mustard/40",
    text: "text-mustard",
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
  // Only show backtest on litigation / management / news rows. Fallback rows
  // are detector-level signals and don't carry an event-style backtest.
  if (signal.iconKind === "fallback") return null

  const liftPretty =
    stat.lift && Number.isFinite(stat.lift) ? `${stat.lift.toFixed(1)}× baseline` : "lift n/a"
  const baselineLine =
    stat.baselinePct !== null
      ? `Baseline rate across ${stat.baselineN ?? "—"} borrower-quarter observations is ${stat.baselinePct.toFixed(
          1,
        )}%.`
      : "Baseline rate not available in this snapshot — treat the headline rate as a methodology benchmark."

  return (
    <div className="mt-3 rounded-md border border-default bg-elevated px-4 py-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-dim">
        ⊙ what usually follows · backtest n={stat.nEvents}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-2xl font-medium text-brick-red">
          {stat.hitRatePct.toFixed(1)}%
        </span>
        <span className="font-serif text-[13px] italic text-muted">
          of borrower {signal.iconKind} events were followed by a mark-drift detector hit within 9 months
        </span>
        <span className="rounded-sm border border-brick-red/40 bg-brick-red-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brick-red">
          {liftPretty}
        </span>
      </div>
      <p className="mt-2 font-serif text-[12.5px] leading-relaxed text-muted">
        {baselineLine} {stat.isLive ? "Computed live from detector_hits + enrichments." : "Lift is the strongest single predictive pattern observed in our backtest."}
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
    <section aria-label="Forward signals" className="rounded-xl border border-default bg-card">
      <header className="flex flex-col gap-1 border-b border-default px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="freshness-dot" />
          <span className="font-mono text-[11.5px] uppercase tracking-wider text-default">
            Forward signals · live enrichments
          </span>
        </div>
        <span className="font-serif text-[13px] italic text-muted">
          Leading indicators on your positions — non-mark events the next filing will probably reflect.
        </span>
      </header>

      {signals.length === 0 ? (
        <div className="p-6 text-center font-serif text-[14px] italic text-muted">
          No enriched signals on GSCR or GSBD in the recent window.
        </div>
      ) : (
        <ul className="divide-y divide-default">
          {signals.map((s) => {
            const impact = IMPACT_STYLE[s.impact]
            const host = safeHost(s.sourceUrl)
            return (
              <li key={s.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[44px_140px_1fr_180px]">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-md border text-base ${ICON_STYLE[s.iconKind]}`}
                  aria-hidden
                >
                  {ICONS[s.iconKind]}
                </div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-dim">
                  <div>{fmtDateMeta(s.date, s.daysAgo)}</div>
                  <div className="mt-1 text-muted">{s.typeLabel}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-sm leading-snug text-default">
                    {s.fund ? (
                      <span className="mr-2 font-mono text-xs font-medium text-gs-gold">
                        {s.fund}
                      </span>
                    ) : null}
                    <span className="font-semibold">{s.company}</span>
                    <span className="text-muted"> — </span>
                    <span>{s.headline}</span>
                  </div>
                  <p className="mt-1 font-serif text-[13px] leading-relaxed text-muted">
                    {s.summary}
                  </p>
                  <div className="mt-1 font-mono text-[10.5px] text-dim">
                    {s.sourceUrl ? (
                      <>
                        source:{" "}
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-terracotta hover:underline"
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
                    className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${impact.bg} ${impact.text}`}
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
