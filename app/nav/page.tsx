import type { Metadata } from "next"
import {
  getBacktestRuns,
  getCurrentMethodology,
  getDailyMarks,
  getLatestMarkDate,
  getOverridesForRows,
  getTunedIndustries,
  summarize,
} from "@/lib/nav/queries"
import { getReconciliationStats } from "@/lib/nav/reconcile"
import { AccuracyCard } from "@/components/nav/accuracy-card"
import { BacktestCard } from "@/components/nav/backtest-card"
import { DailyMarksTable } from "@/components/nav/daily-marks-table"
import { MoverTiles } from "@/components/nav/mover-tile"
import { ReviewQueue } from "@/components/nav/review-queue"
import { TunedIndustriesCard } from "@/components/nav/tuned-industries-card"

export const revalidate = 60

export const metadata: Metadata = {
  title: "Daily NAV",
  description:
    "Daily marks on GSCR positions, modeled from public comparables (FRED HY OAS, BKLN, sector ETFs) with detector-driven overlays. Decision-support — not a 40-Act fair-value mark.",
}

type SearchParams = { fund?: string; date?: string }

function parseFund(input: string | undefined): string {
  if (input === "GSBD") return "GSBD"
  return "GSCR"
}

export default async function NavPage({ searchParams }: { searchParams: SearchParams }) {
  const fund = parseFund(searchParams.fund)
  const explicitDate = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
    ? searchParams.date
    : null
  const [latestDate, methodology, accuracy, backtestRuns] = await Promise.all([
    explicitDate ? Promise.resolve(explicitDate) : getLatestMarkDate(fund),
    getCurrentMethodology(),
    getReconciliationStats(fund),
    getBacktestRuns(fund, 6),
  ])
  const tunedVersion = methodology?.version ?? "v1.1.0"
  const [rows, overrides, tunedIndustries] = await Promise.all([
    getDailyMarks(fund, latestDate),
    getOverridesForRows(fund, latestDate),
    getTunedIndustries(tunedVersion),
  ])
  const summary = summarize(rows)

  return (
    <main className="flex flex-col gap-6">
      <header
        className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <div className="mb-[6px] font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
            your fund · {fund} · {latestDate ?? "no marks yet"}
          </div>
          <h1 className="font-serif text-[34px] font-normal leading-[1.15] tracking-[-0.6px] text-text">
            <span className="text-gs">Daily NAV</span> marking
          </h1>
          <p className="mt-2 max-w-[760px] font-serif text-[15px] leading-[1.55] text-text-dim">
            Every GSCR position re-marked daily from public comparables (FRED HY
            OAS, BKLN, SPDR sector ETFs) with detector-driven idiosyncratic
            overlays. Decision-support — not a 40-Act fair-value mark, not a
            substitute for the quarterly Houlihan process.
          </p>
        </div>
      </header>

      <MoverTiles summary={summary} methodologyVersion={methodology?.version ?? null} />

      <AccuracyCard stats={accuracy} />

      <BacktestCard runs={backtestRuns} />

      <TunedIndustriesCard rows={tunedIndustries} methodologyVersion={tunedVersion} />

      {rows.length === 0 ? (
        <EmptyState fund={fund} />
      ) : (
        <>
          <DailyMarksTable rows={rows} overrides={overrides} />
          <ReviewQueue rows={rows} />
        </>
      )}

      <footer
        className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 font-mono text-[10.5px] text-text-faint"
        style={{ borderColor: "var(--line)" }}
      >
        <span>
          {rows.length} positions · methodology {methodology?.version ?? "—"} · marks at 10:30 AM ET (15:00 UTC)
        </span>
        <span>
          inputs: FRED · Yahoo Finance · detector_hits · observations
        </span>
      </footer>
    </main>
  )
}

function EmptyState({ fund }: { fund: string }) {
  return (
    <section
      className="rounded-md border px-5 py-6"
      style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
    >
      <h2 className="font-serif text-[18px] text-text">No marks yet for {fund}.</h2>
      <ol className="mt-3 list-decimal pl-5 font-serif text-[13.5px] leading-[1.6] text-text-dim">
        <li>
          Apply migration <code className="font-mono text-[12px]">20260516_create_daily_marks.sql</code>{" "}
          against your Supabase project.
        </li>
        <li>
          Run the seed{" "}
          <code className="font-mono text-[12px]">20260516_seed_position_benchmark_map.sql</code>{" "}
          to map the top 20 {fund} exposures.
        </li>
        <li>
          Set <code className="font-mono text-[12px]">CRON_SECRET</code> and{" "}
          <code className="font-mono text-[12px]">FRED_API_KEY</code> in env vars.
        </li>
        <li>
          Trigger the cron once:{" "}
          <code className="font-mono text-[12px]">
            curl &apos;https://&lt;host&gt;/api/cron/mark-positions?secret=$CRON_SECRET&apos;
          </code>
        </li>
      </ol>
    </section>
  )
}
