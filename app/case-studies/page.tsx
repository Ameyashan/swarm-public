import Link from "next/link"
import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CASE_STUDIES, type CaseStudy } from "@/lib/case-studies"
import { formatFV, formatPct } from "@/lib/format"
import { FvTrajectoryChart } from "@/components/fv-trajectory-chart"

import type { Metadata } from "next"
export const dynamic = "force-static"

export const metadata: Metadata = {
  title: "Case studies",
  description:
    "How Swarm Public detectors caught real BDC mark drift, cross-fund divergence, and PIK creep events — step by step, with citations.",
}

function fmtDate(s: string): string {
  try {
    return format(new Date(s), "MMM d, yyyy")
  } catch {
    return s
  }
}

export default function CaseStudiesPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-12">
      <div className="mb-6 text-sm">
        <Link
          href="/"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Home
        </Link>
      </div>

      <header className="mb-12">
        <Badge variant="outline" className="mb-3">
          Retroactive validation
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Case studies
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
          Situations where our detectors fired before a publicly-known wipeout,
          downgrade, or major writedown — measured against what eventually
          happened to the position in subsequent BDC filings and press
          coverage.
        </p>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
          Each case is built from the same{" "}
          <Link href="/alerts" className="underline-offset-4 hover:underline">
            detector_hits
          </Link>{" "}
          surfaced by the live pipeline.
        </p>
      </header>

      <div className="flex flex-col gap-12">
        {CASE_STUDIES.map((c) => (
          <CaseStudyCard key={c.slug} study={c} />
        ))}
      </div>
    </main>
  )
}

function CaseStudyCard({ study }: { study: CaseStudy }) {
  return (
    <article id={study.slug}>
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/30 pb-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="bg-red-600 text-white hover:bg-red-600/90 border-transparent">
              {study.lead_time_label}
            </Badge>
            {study.fund_tickers.map((t) => (
              <span
                key={t}
                className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {t}
              </span>
            ))}
            {study.industry ? (
              <span className="text-xs text-muted-foreground">
                · {study.industry}
              </span>
            ) : null}
          </div>
          <CardTitle className="text-2xl tracking-tight sm:text-3xl">
            {study.company}
          </CardTitle>
          <p className="mt-2 text-base text-muted-foreground">
            {study.headline}
          </p>
        </CardHeader>

        <CardContent className="p-6 sm:p-8">
          {/* FV trajectory chart */}
          <section className="mb-8">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Fair value trajectory
              </h3>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-foreground" />
                  Fair value
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-600" />
                  Detector fired
                </span>
              </div>
            </div>
            <div className="rounded-md border bg-card p-4">
              <FvTrajectoryChart data={study.fv_trajectory} />
            </div>
          </section>

          {/* Detector events */}
          <section className="mb-8">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              When our detectors fired
            </h3>
            <ul className="space-y-3">
              {study.detector_events.map((e, i) => (
                <li
                  key={i}
                  className="rounded-md border-l-4 border-red-500 bg-muted/40 p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{e.detector}</span>
                    <span className="text-xs text-muted-foreground">
                      · {fmtDate(e.fired_on)}
                    </span>
                    {e.severity != null ? (
                      <span className="text-xs text-muted-foreground">
                        · severity {formatPct(e.severity)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm">{e.trigger}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* What happened next */}
          <section className="mb-8">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              What happened next
            </h3>
            <div className="rounded-md border bg-card p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-red-600">
                {fmtDate(study.outcome.occurred_on)}
              </div>
              <p className="text-sm">{study.outcome.event}</p>
              {study.outcome.fv_at_event_thousands != null ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Position FV at this point:{" "}
                  {formatFV(study.outcome.fv_at_event_thousands * 1000)}
                </p>
              ) : null}
            </div>
          </section>

          {/* Narrative */}
          <section className="mb-8">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Narrative
            </h3>
            <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground">
              {study.narrative.split(/\n\n+/).map((para, i) => (
                <p key={i} className="mb-3 last:mb-0">
                  {para}
                </p>
              ))}
            </div>
          </section>

          {/* Two columns: filings + enrichment */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Source filings
              </h3>
              <ul className="space-y-2 text-sm">
                {study.source_filings.map((f, i) => (
                  <li key={i}>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {f.label} →
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Enrichment context
              </h3>
              <div className="rounded-md border bg-card p-4 text-sm">
                {study.enrichment.sponsor ? (
                  <div className="mb-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Sponsor
                    </div>
                    <div className="font-medium">
                      {study.enrichment.sponsor}
                      {study.enrichment.acquired
                        ? ` (acquired ${study.enrichment.acquired})`
                        : ""}
                    </div>
                  </div>
                ) : null}
                {study.enrichment.highlights &&
                study.enrichment.highlights.length > 0 ? (
                  <div>
                    <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                      Highlights
                    </div>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                      {study.enrichment.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </CardContent>
      </Card>
    </article>
  )
}
