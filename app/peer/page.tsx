import type { Metadata } from "next"
import { getPeerCohort, type PeerCohortFund } from "@/lib/peer/queries"
import {
  PeerCard,
  isGoldman,
  type PanelTone,
  type PeerBarRow,
} from "@/components/peer/peer-card"

export const revalidate = 300

export const metadata: Metadata = {
  title: "Peer telemetry",
  description:
    "GSCR and GSBD pinned across credit-quality dimensions vs the BDC universe. Live from Supabase observations + detector_hits.",
}

// ─────────────────────────────────────────────────────────────────────────────
// Rank / callout helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtPct(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(digits)}%`
}

function fmtPp(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}${Math.abs(n).toFixed(2)}pp`
}

function fmtCount(n: number): string {
  return n.toLocaleString()
}

/** Tone for "higher is worse" metrics (PIK, NA, hit count). */
function toneHigherWorse(rank0: number, total: number): PanelTone {
  if (total <= 1) return "watch"
  const p = rank0 / (total - 1) // 0 = lowest value (best), 1 = highest (worst)
  if (p >= 0.66) return "crit"
  if (p >= 0.34) return "watch"
  return "ok"
}

/** Tone for mark variance — high absolute deviation is the watch signal. */
function toneVariance(value: number | null, maxAbs: number): PanelTone {
  if (value === null || !Number.isFinite(value)) return "ok"
  if (maxAbs <= 0) return "ok"
  const r = Math.abs(value) / maxAbs
  if (r >= 0.66) return "watch"
  return "ok"
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Build a row list for a "higher is worse" metric, sorted desc. */
function buildBarsHigherWorse(
  cohort: PeerCohortFund[],
  valueOf: (f: PeerCohortFund) => number | null,
  display: (f: PeerCohortFund) => string,
): PeerBarRow[] {
  const filtered = cohort.filter((f) => valueOf(f) !== null)
  const sorted = [...filtered].sort(
    (a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0),
  )
  return sorted.map((f, i) => ({
    ticker: f.fund_ticker,
    value: valueOf(f),
    display: display(f),
    tone: toneHigherWorse(sorted.length - 1 - i, sorted.length),
    isGoldman: isGoldman(f.fund_ticker),
  }))
}

/** Variance bars are sorted by signed value desc so positive (marks above
 *  median) is at the top. */
function buildBarsVariance(cohort: PeerCohortFund[]): PeerBarRow[] {
  const filtered = cohort.filter(
    (f) => f.mark_variance_pp !== null && Number.isFinite(f.mark_variance_pp),
  )
  const sorted = [...filtered].sort(
    (a, b) => (b.mark_variance_pp ?? 0) - (a.mark_variance_pp ?? 0),
  )
  const maxAbs = Math.max(
    ...sorted.map((f) => Math.abs(f.mark_variance_pp ?? 0)),
    0,
  )
  return sorted.map((f) => ({
    ticker: f.fund_ticker,
    value: f.mark_variance_pp ?? 0,
    display: fmtPp(f.mark_variance_pp),
    tone: toneVariance(f.mark_variance_pp, maxAbs),
    isGoldman: isGoldman(f.fund_ticker),
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Callout builders — all deterministic from live cohort.
// ─────────────────────────────────────────────────────────────────────────────

function calloutHigherWorse(
  bars: PeerBarRow[],
  unit: "pct" | "count",
  metricName: string,
): string {
  if (bars.length === 0) return "Cohort data unavailable for this metric."
  const gscr = bars.find((b) => b.ticker === "GSCR")
  const gsbd = bars.find((b) => b.ticker === "GSBD")
  const n = bars.length
  const fmt = (v: number | null) =>
    v === null
      ? "—"
      : unit === "pct"
        ? fmtPct(v, 2)
        : fmtCount(Math.round(v))
  const parts: string[] = []
  if (gsbd) {
    const rank = bars.findIndex((b) => b.ticker === "GSBD") + 1
    parts.push(
      `GSBD ranks ${ordinal(rank)} of ${n} at ${fmt(gsbd.value)} ${metricName}.`,
    )
  }
  if (gscr) {
    const rank = bars.findIndex((b) => b.ticker === "GSCR") + 1
    parts.push(
      `GSCR ranks ${ordinal(rank)} of ${n} at ${fmt(gscr.value)}.`,
    )
  }
  // Add a one-line peer comparison: who's worst / best.
  const worst = bars[0]
  const best = bars[bars.length - 1]
  if (worst && best && worst.ticker !== best.ticker) {
    parts.push(
      `${worst.ticker} sits highest at ${fmt(worst.value)}; ${best.ticker} lowest at ${fmt(best.value)}.`,
    )
  }
  return parts.join(" ")
}

function calloutVariance(bars: PeerBarRow[]): string {
  if (bars.length === 0) {
    return "Mark variance not yet derivable from the cohort — need more shared-borrower mark events."
  }
  const gscr = bars.find((b) => b.ticker === "GSCR")
  const gsbd = bars.find((b) => b.ticker === "GSBD")
  const parts: string[] = []
  if (gscr) {
    const rank = bars.findIndex((b) => b.ticker === "GSCR") + 1
    const v = gscr.value ?? 0
    const dir =
      v > 0.05 ? "marks above cohort median" : v < -0.05 ? "marks below cohort median" : "marks in line with cohort"
    parts.push(`GSCR ${dir} at ${fmtPp(gscr.value)} (${ordinal(rank)} of ${bars.length}).`)
  }
  if (gsbd) {
    parts.push(`GSBD ${fmtPp(gsbd.value)} vs cohort median.`)
  }
  parts.push(
    "Sustained positive variance can become a credibility issue with auditors; sustained negative variance can mean late marks.",
  )
  return parts.join(" ")
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function PeerTelemetryPage() {
  const cohort = await getPeerCohort()

  const pikBars = buildBarsHigherWorse(
    cohort,
    (f) => f.pik_pct,
    (f) => fmtPct(f.pik_pct, 1),
  )
  const naBars = buildBarsHigherWorse(
    cohort,
    (f) => f.na_pct,
    (f) => fmtPct(f.na_pct, 2),
  )
  const hitBars = buildBarsHigherWorse(
    cohort,
    (f) => f.hit_count_recent,
    (f) => fmtCount(f.hit_count_recent),
  )
  const varBars = buildBarsVariance(cohort)

  const tickerList = cohort.map((f) => f.fund_ticker).join(" · ")
  const latestPeriods = Array.from(
    new Set(cohort.map((f) => f.period_end).filter(Boolean) as string[]),
  ).sort()
  const latestStamp = latestPeriods.length > 0 ? latestPeriods[latestPeriods.length - 1] : null

  return (
    <main className="flex flex-col gap-6">
      <header
        className="border-b pb-5"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="mb-[6px] font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          cohort · {cohort.length} BDCs · {latestStamp ? `latest filings through ${latestStamp}` : "latest filings"}
        </div>
        <h1 className="font-serif text-[34px] font-normal leading-[1.15] tracking-[-0.6px] text-text">
          You vs the universe
        </h1>
        <p className="mt-2 max-w-[760px] font-serif text-[15px] leading-[1.55] text-text-dim">
          <span className="text-gs">GSCR</span> and{" "}
          <span className="text-gs">GSBD</span> pinned across four credit-quality
          dimensions. Bars sorted worst-first. Use this view when LP, IR, or
          risk asks <em>are we worse than peers?</em>
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PeerCard
          title="PIK share of fair value"
          sub="Higher means more interest income is accruing as PIK rather than cash — a credit-stress signal."
          rows={pikBars}
          callout={calloutHigherWorse(pikBars, "pct", "PIK share")}
          emptyMessage="No PIK data available in the cohort."
        />

        <PeerCard
          title="Non-accrual share of FV"
          sub="Positions where interest is no longer being recognized — direct measure of impaired credit."
          rows={naBars}
          callout={calloutHigherWorse(naBars, "pct", "non-accrual share")}
          emptyMessage="No non-accrual data available in the cohort."
        />

        <PeerCard
          title="Detector hits · last ~6 months"
          sub="Mark-drift, PIK creep, cross-fund divergence — combined signal volume across all detectors on each fund."
          rows={hitBars}
          callout={calloutHigherWorse(hitBars, "count", "recent detector hits")}
          emptyMessage="No detector hits in the recent window."
        />

        <PeerCard
          title="Cross-fund mark variance"
          sub="Mean mark-drift gap vs the cohort median (in percentage points). Positive = marks above cohort median; negative = marks below."
          rows={varBars}
          callout={calloutVariance(varBars)}
          emptyMessage="Mark variance not yet derivable from the cohort."
        />
      </section>

      <footer
        className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 font-mono text-[10.5px] text-text-faint"
        style={{ borderColor: "var(--line)" }}
      >
        <span>cohort: {tickerList || "—"} · all latest filings</span>
        <span>live · SEC EDGAR · not investment advice</span>
      </footer>
    </main>
  )
}
