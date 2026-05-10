"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTransition } from "react"
import type { DetectorHit } from "@/app/alerts/alerts-helpers"
import { OverviewTab } from "./overview-tab"
import { ByFundTab, type FundSummary } from "./by-fund-tab"
import { HitsTab } from "./hits-tab"
import { IntelligenceTab, type Enrichment, type EnrichmentQueueRow } from "./intelligence-tab"

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "by-fund", label: "By Fund" },
  { key: "hits", label: "Detector Hits" },
  { key: "intel", label: "Intelligence" },
] as const

type TabKey = (typeof TABS)[number]["key"]

export type StackedRow = Record<string, number | string>

export type PeriodHits = { period: string; hits: DetectorHit[] }

type Props = {
  canonical: string
  slug: string
  initialTab: string
  // Overview
  stackedSeries: StackedRow[]
  fundTickers: string[]
  periodHits: PeriodHits[]
  accrualPct: number | null
  fvOverCostPct: number | null
  driftSeries: Array<{ x: string; y: number }>
  totalHits: number
  latestTotalFv: number
  latestFvSum: number
  latestCostSum: number
  // By Fund
  fundSummaries: FundSummary[]
  // Hits
  timelineHits: DetectorHit[]
  // Intel
  enrichment: Enrichment | null
  latestQueue: EnrichmentQueueRow | null
}

export function WatchTabs(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const currentTab = (TABS.find((t) => t.key === props.initialTab)?.key ??
    "overview") as TabKey

  function go(key: TabKey) {
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    if (key === "overview") {
      params.delete("tab")
    } else {
      params.set("tab", key)
    }
    const qs = params.toString()
    startTransition(() => {
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
    })
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-6 -mx-6 overflow-x-auto px-6">
        <nav
          className="inline-flex gap-1 rounded-lg border border-border bg-[#0F1623] p-1"
          role="tablist"
          aria-label="Borrower views"
        >
          {TABS.map((t) => {
            const active = t.key === currentTab
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => go(t.key)}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-500/20 text-blue-100 ring-1 ring-blue-500/40"
                    : "text-muted-foreground hover:text-foreground"
                } ${isPending && active ? "opacity-70" : ""}`}
              >
                {t.label}
              </button>
            )
          })}
        </nav>
      </div>

      <div role="tabpanel">
        {currentTab === "overview" && (
          <OverviewTab
            stackedSeries={props.stackedSeries}
            fundTickers={props.fundTickers}
            periodHits={props.periodHits}
            accrualPct={props.accrualPct}
            fvOverCostPct={props.fvOverCostPct}
            driftSeries={props.driftSeries}
            totalHits={props.totalHits}
            latestFvSum={props.latestFvSum}
            latestCostSum={props.latestCostSum}
          />
        )}
        {currentTab === "by-fund" && (
          <ByFundTab fundSummaries={props.fundSummaries} />
        )}
        {currentTab === "hits" && <HitsTab hits={props.timelineHits} />}
        {currentTab === "intel" && (
          <IntelligenceTab
            canonical={props.canonical}
            enrichment={props.enrichment}
            latestQueue={props.latestQueue}
          />
        )}
      </div>
    </div>
  )
}
