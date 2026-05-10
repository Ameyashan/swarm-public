import type { Metadata } from "next"
import {
  getTopGoldmanHits,
  getRecentGoldmanHits,
  getGoldmanEnrichmentEvents,
  getPeerTelemetry,
  getLitigationBacktest,
  bucketHits,
  sevScore100,
  type DetectorHitRow,
} from "@/lib/briefing/queries"
import {
  buildEditorialHeadline,
  pickChangedCards,
  buildSignalRows,
  buildCommitteeQuestions,
} from "@/lib/briefing/derive"
import { BriefingHero } from "@/components/briefing/briefing-hero"
import { EditorialHeadlineBlock } from "@/components/briefing/editorial-headline"
import { WhatChangedGrid } from "@/components/briefing/what-changed"
import { ForwardSignals, type BacktestStat } from "@/components/briefing/forward-signals"
import { CommitteeQuestions } from "@/components/briefing/committee-questions"
import { PeerRankPanel } from "@/components/briefing/peer-rank"

// Server-rendered with revalidation so per-request Supabase load stays
// bounded. Briefing is read-only.
export const revalidate = 300

export const metadata: Metadata = {
  title: "Morning briefing · Goldman PM workspace",
  description:
    "Daily live-data briefing for the Goldman PM managing GSCR + GSBD: what changed, forward signals, committee questions, peer rank.",
}

// ─────────────────────────────────────────────────────────────────────────────
// Mark-variance percentile helper.
// We approximate "mark variance" as the standard deviation of fair-value
// percentage changes between consecutive periods on Goldman names, then rank
// GSCR vs other funds in our hit dataset. This is a *derived* metric — we
// compute it on the fly from the same detector_hits we already loaded so we
// don't double the database round-trips.
// ─────────────────────────────────────────────────────────────────────────────
function computeMarkVariance(
  allHits: DetectorHitRow[],
): { percentile: number; label: string } | null {
  const driftHits = allHits.filter((h) => h.detector_name === "mark_drift_down")
  if (driftHits.length === 0) return null
  const byFund = new Map<string, number[]>()
  for (const h of driftHits) {
    const t = h.fund_ticker
    if (!t) continue
    const ch = Number(h.hit_data?.fv_change_pct)
    if (!Number.isFinite(ch)) continue
    if (!byFund.has(t)) byFund.set(t, [])
    byFund.get(t)!.push(ch)
  }
  if (byFund.size === 0) return null
  function stddev(xs: number[]) {
    if (xs.length === 0) return 0
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
    return Math.sqrt(variance)
  }
  const stds: { fund: string; std: number }[] = []
  Array.from(byFund.entries()).forEach(([fund, vals]) => {
    stds.push({ fund, std: stddev(vals) })
  })
  const gscr = stds.find((s) => s.fund === "GSCR")
  if (!gscr) return null
  const sorted = [...stds].sort((a, b) => a.std - b.std)
  const idx = sorted.findIndex((s) => s.fund === "GSCR")
  const percentile =
    sorted.length > 0 ? Math.round((idx / Math.max(1, sorted.length - 1)) * 100) : 50
  return { percentile, label: `P${percentile}` }
}

export default async function BriefingPage() {
  // Fan out reads in parallel.
  const [topHits, recentHits, enrichEvents, peerStats, backtest, hitUniverse] =
    await Promise.all([
      getTopGoldmanHits(12),
      getRecentGoldmanHits(40),
      getGoldmanEnrichmentEvents(20),
      getPeerTelemetry(),
      getLitigationBacktest(),
      // Reuse the broader hit pull for the mark-variance approximation.
      getRecentGoldmanHits(200),
    ])

  // Combine top + recent so the editorial paragraph has both perspectives.
  const merged: DetectorHitRow[] = (() => {
    const seen = new Set<string>()
    const out: DetectorHitRow[] = []
    for (const h of [...recentHits, ...topHits]) {
      if (seen.has(h.id)) continue
      seen.add(h.id)
      out.push(h)
    }
    return out
  })()
  const buckets = bucketHits(merged)
  const cards = pickChangedCards(buckets)
  const headline = buildEditorialHeadline(merged.slice(0, 30))

  const signalRows = buildSignalRows(enrichEvents, 5)
  const committee = buildCommitteeQuestions(merged, signalRows)

  const backtestStat: BacktestStat | null = backtest
    ? {
        hitRatePct: backtest.hit_rate_pct,
        baselinePct: backtest.baseline_pct,
        lift: backtest.lift,
        nEvents: backtest.n_events,
        baselineN: backtest.baseline_n ?? null,
        isLive: true,
      }
    : null

  const markVar = computeMarkVariance(hitUniverse)

  // Hero counts come straight from the bucketed merged set.
  const heroCounts = {
    critical: buckets.critical.length,
    watch: buckets.watch.length,
    info: buckets.info.length,
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <BriefingHero
        critical={heroCounts.critical}
        watch={heroCounts.watch}
        info={heroCounts.info}
      />

      <EditorialHeadlineBlock headline={headline} />

      <WhatChangedGrid cards={cards} />

      <ForwardSignals signals={signalRows} backtest={backtestStat} />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
        <CommitteeQuestions questions={committee} />
        <PeerRankPanel
          stats={peerStats}
          markVariance={markVar}
        />
      </section>

      {/* Surface a hint that the rest of the workflow surfaces are coming. */}
      <section className="mt-6 flex flex-wrap items-center gap-3 border-t border-default pt-6 font-mono text-[11px] text-dim">
        <span>Next:</span>
        <span className="rounded-sm border border-default bg-card px-2 py-0.5">Position Book</span>
        <span className="rounded-sm border border-default bg-card px-2 py-0.5">Borrower X-Ray</span>
        <span className="rounded-sm border border-default bg-card px-2 py-0.5">Peer Telemetry</span>
        <span className="rounded-sm border border-default bg-card px-2 py-0.5">Patterns</span>
        <span className="rounded-sm border border-default bg-card px-2 py-0.5">Memo Composer</span>
        <span className="ml-auto">Briefing surfaces · live · {sevScore100(merged[0]?.severity_score ?? 0)} top sev</span>
      </section>
    </main>
  )
}
