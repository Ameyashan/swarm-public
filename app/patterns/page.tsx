import type { Metadata } from "next"
import {
  getPresetClusters,
  getHeroLiftStats,
  getClusterSignalCount,
  runComposerQuery,
  type ClusterCard,
  type LiftStat,
  type ComposerResults,
} from "@/lib/patterns/queries"
import { parsePatternQuery } from "@/lib/patterns/parse"
import { EMPTY_FILTERS, type ParsedQuery } from "@/lib/patterns/schema"
import { PatternsComposer, type ComposerResultsClient } from "./composer"
import { ClusterCardView } from "@/components/patterns/cluster-card"

export const metadata: Metadata = {
  title: "Patterns",
  description:
    "Cross-borrower cluster detection + natural-language composer for the Goldman PM. Backtested over 1,051 detector hits + 632 enrichments.",
}

export const revalidate = 600

const DEFAULT_QUERY =
  "Goldman positions with management changes in the last 6 months where the mark cut more than 30%"

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(digits)}%`
}
function fmtLift(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ""
  return `${n.toFixed(1)}× baseline`
}

export default async function PatternsPage() {
  // Default landing-state composer query — we parse + run it server-side so
  // the page renders something concrete on first paint instead of an empty
  // composer.
  const apiKeyMissing = !process.env.ANTHROPIC_API_KEY

  let initialParsed: ParsedQuery = { filters: EMPTY_FILTERS, field_confidence: {} }
  let initialParseError: string | null = null
  let initialResults: ComposerResults = {
    rows: [],
    total: 0,
    avg_severity: 0,
    total_fv_dollars: 0,
    query_plan: [],
  }

  if (!apiKeyMissing) {
    const parseRes = await parsePatternQuery(DEFAULT_QUERY)
    if (parseRes.ok) {
      initialParsed = parseRes.parsed
      initialResults = await runComposerQuery(parseRes.parsed.filters)
    } else {
      initialParseError = parseRes.error
    }
  } else {
    initialParseError =
      "ANTHROPIC_API_KEY is not set on the server. The composer will not be able to parse natural-language queries until it is set."
  }

  const [presetClusters, lift, clusterCount] = await Promise.all([
    getPresetClusters(),
    getHeroLiftStats(),
    getClusterSignalCount(),
  ])

  return (
    <main className="flex flex-col gap-6">
      <header
        className="border-b pb-5"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="mb-[6px] font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          {presetClusters.length} active clusters · last 12 months · learned from 1,051 detector hits + 632 enrichments
        </div>
        <h1 className="font-serif text-[34px] font-normal leading-[1.15] tracking-[-0.6px] text-text">
          Patterns across borrowers
        </h1>
        <p className="mt-2 max-w-[760px] font-serif text-[15px] leading-[1.55] text-text-dim">
          When the same kind of leading indicator shows up in multiple borrowers from a shared sector, sponsor, or vintage, that&apos;s a sector-level signal — not coincidence. Each cluster below is back-tested against historical mark trajectories.
        </p>
      </header>

      {apiKeyMissing ? (
        <div
          className="rounded-[8px] border px-4 py-3 font-mono text-[11.5px]"
          style={{ background: "var(--amber-bg)", borderColor: "var(--amber)", color: "var(--amber)" }}
        >
          ⚠ <strong>ANTHROPIC_API_KEY</strong> is not set on the server. The composer below will refuse natural-language queries until it is set. Preset clusters and the lift backtests below remain live (they don&apos;t require the model).
        </div>
      ) : null}

      <PatternsComposer
        initialQuery={DEFAULT_QUERY}
        initialParsed={initialParsed}
        initialResults={toClient(initialResults)}
        initialParseError={initialParseError}
      />

      {/* Hero stats — live lift backtests */}
      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-4"
      >
        {lift.map((s) => (
          <LiftCard key={s.label} stat={s} />
        ))}
        <ClusterSignalCard count={clusterCount} />
      </section>

      <div className="flex items-center justify-between">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          preset patterns · always-on
        </div>
        <div className="font-mono text-[10.5px] text-text-faint">
          {presetClusters.length} cluster{presetClusters.length === 1 ? "" : "s"} surfaced from live data
        </div>
      </div>

      {presetClusters.length === 0 ? (
        <div
          className="rounded-[8px] border px-4 py-6 text-center font-serif italic text-text-dim"
          style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
        >
          No preset clusters surfaced yet — the underlying detector_hits universe may be too small in the current window.
        </div>
      ) : (
        presetClusters.map((c: ClusterCard) => <ClusterCardView key={c.id} card={c} />)
      )}

      <footer
        className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 font-mono text-[10.5px] text-text-faint"
        style={{ borderColor: "var(--line)" }}
      >
        <span>patterns refresh nightly · methodology: borrower-quarter event windows + 270-day forward look</span>
        <span>backtested on live enrichments · cited to SEC EDGAR · not investment advice</span>
      </footer>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function LiftCard({ stat }: { stat: LiftStat }) {
  const lift = stat.lift
  return (
    <div
      className="rounded-[10px] border px-5 py-[18px]"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[1.2px] text-text-faint">
        {stat.label}
      </div>
      <div className="font-mono text-[26px] leading-none">
        {fmtPct(stat.hit_rate_pct, 1)}
        {lift != null ? (
          <span className="ml-[6px] text-[13px] text-green">
            {fmtLift(lift)}
          </span>
        ) : null}
      </div>
      <div className="mt-[6px] font-serif text-[12px] leading-[1.5] text-text-dim">
        {stat.description}
        {stat.baseline_pct != null ? (
          <> Baseline {fmtPct(stat.baseline_pct, 1)} ({stat.n_events} events).</>
        ) : null}
      </div>
    </div>
  )
}

function ClusterSignalCard({ count }: { count: number }) {
  return (
    <div
      className="rounded-[10px] border px-5 py-[18px]"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[1.2px] text-text-faint">
        cluster signals
      </div>
      <div className="font-mono text-[26px] leading-none" style={{ color: count > 0 ? "var(--red)" : "var(--text-dim)" }}>
        {count}
      </div>
      <div className="mt-[6px] font-serif text-[12px] leading-[1.5] text-text-dim">
        Industry clusters with ≥ 4 borrowers at severity ≥ 50 in the trailing 12 months.
      </div>
    </div>
  )
}

function toClient(r: ComposerResults): ComposerResultsClient {
  return {
    total: r.total,
    avg_severity: r.avg_severity,
    total_fv_dollars: r.total_fv_dollars,
    query_plan: r.query_plan,
    rows: r.rows.map((row) => ({
      borrower: row.borrower,
      fund_tickers: row.fund_tickers,
      max_severity: row.max_severity,
      hit_count: row.hit_count,
      n_litigation: row.n_litigation,
      n_mgmt: row.n_mgmt,
      n_news: row.n_news,
      fv_dollars: row.fv_dollars,
      is_pik: row.is_pik,
      any_non_accrual: row.any_non_accrual,
      goldman_held: row.goldman_held,
      sponsor: row.sponsor,
      industry: row.industry,
      all_funds_holding: row.all_funds_holding,
    })),
  }
}
