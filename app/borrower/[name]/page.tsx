import type { Metadata } from "next"
import { getBorrowerXray } from "@/lib/borrower/queries"
import { buildBorrowerSummary } from "@/lib/borrower/summary"
import { XrayHero } from "@/components/borrower/xray-hero"
import { MarkChart } from "@/components/borrower/mark-chart"
import { LatestMarksTable } from "@/components/borrower/latest-marks-table"
import {
  ImpliedNextCard,
  SponsorCrossCheckCard,
  LeadingIndicatorsCard,
} from "@/components/borrower/right-rail"
import { BacktestCard } from "@/components/borrower/backtest-card"

export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: { name: string }
}): Promise<Metadata> {
  const name = decodeURIComponent(params.name)
  return {
    title: `${name} · Borrower x-ray`,
    description: `Cross-fund mark history, latest marks vs peer median, leading indicators, and reverse backtest for ${name}.`,
  }
}

export default async function BorrowerXrayPage({
  params,
}: {
  params: { name: string }
}) {
  const name = decodeURIComponent(params.name)
  const xray = await getBorrowerXray(name)

  if (!xray) {
    return (
      <main className="flex flex-col gap-6">
        <header className="border-b pb-6" style={{ borderColor: "var(--line)" }}>
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
            borrower x-ray · no data
          </div>
          <h1 className="font-serif text-[34px] font-normal leading-[1.15] tracking-[-0.6px] text-text">
            {name}
          </h1>
          <p className="mt-3 max-w-[720px] font-serif text-[16px] italic leading-[1.6] text-text-dim">
            No live observations or detector hits surfaced for this borrower in the current
            dataset. The canonical name may differ — try opening this from a row in the position
            book.
          </p>
        </header>
      </main>
    )
  }

  const summary = buildBorrowerSummary(
    xray.meta,
    xray.latest_marks,
    xray.leading_indicators,
  )

  return (
    <main className="flex flex-col gap-6">
      <XrayHero
        meta={xray.meta}
        summary={summary.map((span, i) => {
          if (span.kind === "gs") {
            return (
              <span key={i} style={{ color: "var(--gs)", fontWeight: 500 }}>
                {span.text}
              </span>
            )
          }
          if (span.kind === "crit") {
            return (
              <span key={i} style={{ color: "var(--red)", fontWeight: 500 }}>
                {span.text}
              </span>
            )
          }
          if (span.kind === "warn") {
            return (
              <span key={i} style={{ color: "var(--amber)", fontWeight: 500 }}>
                {span.text}
              </span>
            )
          }
          return <span key={i}>{span.text}</span>
        })}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="flex flex-col gap-6">
          <MarkChart
            series={xray.series}
            events={xray.events}
            borrowerName={xray.meta.canonical_name}
            dailySeries={xray.daily_series}
          />
          {xray.note && (
            <p
              className="rounded-[8px] border px-4 py-2 font-mono text-[11px] italic text-text-faint"
              style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}
            >
              {xray.note}
            </p>
          )}
          <LatestMarksTable rows={xray.latest_marks} />
          <BacktestCard backtest={xray.backtest} />
        </div>

        {/* Right rail */}
        <aside className="flex flex-col gap-4">
          <ImpliedNextCard borrowerName={xray.meta.canonical_name} implied={xray.implied} />
          <SponsorCrossCheckCard
            borrowerName={xray.meta.canonical_name}
            sponsor={xray.meta.sponsor}
            rows={xray.sponsor_cross_check}
          />
          <LeadingIndicatorsCard indicators={xray.leading_indicators} />
        </aside>
      </div>

      <footer
        className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 font-mono text-[10.5px] text-text-faint"
        style={{ borderColor: "var(--line)" }}
      >
        <span>
          live · observations + detector_hits + enrichments · {xray.quarters_rendered} quarter
          {xray.quarters_rendered === 1 ? "" : "s"} rendered
        </span>
        <span>read-only · no LLM</span>
      </footer>
    </main>
  )
}
