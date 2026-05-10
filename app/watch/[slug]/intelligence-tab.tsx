"use client"

import { useState, useTransition } from "react"
import { motion } from "framer-motion"
import { format, formatDistanceToNow } from "date-fns"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { queueEnrichmentRefresh } from "./actions"

export type Enrichment = {
  detector_hit_id: string
  research_summary: string | null
  news_items: any
  litigation_items: any
  sponsor_info: any
  management_changes: any
  generated_at: string
}

export type EnrichmentQueueRow = {
  status: string
  requested_at: string
}

type NewsItem = {
  title?: string
  source?: string
  url?: string
  date?: string
  summary?: string
}
type LitigationItem = {
  case_name?: string
  filed_date?: string
  court?: string
  url?: string
  summary?: string
}
type ManagementChange = {
  name?: string
  role?: string
  change_type?: string
  date?: string
  summary?: string
}

type Props = {
  canonical: string
  enrichment: Enrichment | null
  latestQueue: EnrichmentQueueRow | null
}

function asArray<T>(v: any): T[] {
  if (Array.isArray(v)) return v as T[]
  return []
}

export function IntelligenceTab({ canonical, enrichment, latestQueue }: Props) {
  const news = asArray<NewsItem>(enrichment?.news_items)
  const litigation = asArray<LitigationItem>(enrichment?.litigation_items)
  const managementChanges = asArray<ManagementChange>(enrichment?.management_changes)
  const sponsor = enrichment?.sponsor_info ?? null

  const sparse =
    !enrichment ||
    (news.length === 0 &&
      litigation.length === 0 &&
      managementChanges.length === 0 &&
      !sponsor)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      {sparse ? (
        <SparseState canonical={canonical} latestQueue={latestQueue} />
      ) : (
        <>
          <ReRunBanner canonical={canonical} latestQueue={latestQueue} compact />

          {enrichment?.research_summary && (
            <Card>
              <CardHeader>
                <CardTitle>Research summary</CardTitle>
                <CardDescription>
                  Latest enrichment generated{" "}
                  {format(new Date(enrichment.generated_at), "MMM d, yyyy")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {enrichment.research_summary}
                </p>
              </CardContent>
            </Card>
          )}

          {sponsor && (
            <Card>
              <CardHeader>
                <CardTitle>Sponsor</CardTitle>
              </CardHeader>
              <CardContent>
                <SponsorBlock sponsor={sponsor} />
              </CardContent>
            </Card>
          )}

          {news.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Recent news ({news.length})
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {news.map((n, i) => (
                  <NewsCard key={i} item={n} />
                ))}
              </div>
            </section>
          )}

          {litigation.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Litigation ({litigation.length})
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {litigation.map((l, i) => (
                  <LitigationCard key={i} item={l} />
                ))}
              </div>
            </section>
          )}

          {managementChanges.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Management changes ({managementChanges.length})
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {managementChanges.map((m, i) => (
                  <MgmtCard key={i} item={m} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </motion.div>
  )
}

function SparseState({
  canonical,
  latestQueue,
}: {
  canonical: string
  latestQueue: EnrichmentQueueRow | null
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="rounded-full bg-blue-500/10 p-3">
          <svg
            width={28}
            height={28}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-blue-400"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold">No recent intelligence</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            We haven&apos;t enriched this borrower with web research, news, or
            litigation data yet. Trigger a fresh Perplexity research run on
            demand.
          </p>
        </div>
        <ReRunButton canonical={canonical} latestQueue={latestQueue} />
      </CardContent>
    </Card>
  )
}

function ReRunBanner({
  canonical,
  latestQueue,
  compact,
}: {
  canonical: string
  latestQueue: EnrichmentQueueRow | null
  compact?: boolean
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-[#0F1623] px-4 ${
        compact ? "py-2" : "py-3"
      }`}
    >
      <div className="text-xs text-muted-foreground">
        Want fresher data? Re-run the Perplexity research enrichment.
      </div>
      <ReRunButton canonical={canonical} latestQueue={latestQueue} small />
    </div>
  )
}

function ReRunButton({
  canonical,
  latestQueue,
  small,
}: {
  canonical: string
  latestQueue: EnrichmentQueueRow | null
  small?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState<{
    when: string
    status: "queued" | "error"
    message?: string
  } | null>(
    latestQueue && latestQueue.status === "queued"
      ? { when: latestQueue.requested_at, status: "queued" }
      : null,
  )

  function handleClick() {
    startTransition(async () => {
      const res = await queueEnrichmentRefresh(canonical)
      if (res.ok) {
        setSubmitted({ when: res.queuedAt, status: "queued" })
      } else {
        setSubmitted({
          when: new Date().toISOString(),
          status: "error",
          message: res.error,
        })
      }
    })
  }

  if (submitted?.status === "queued") {
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="border-blue-500/40 text-blue-300"
        >
          Queued
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(submitted.when), { addSuffix: true })}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={handleClick}
        disabled={isPending}
        size={small ? "sm" : "default"}
        className="bg-blue-500 text-white hover:bg-blue-500/90"
      >
        {isPending ? "Queuing…" : "Re-run enrichment"}
      </Button>
      {submitted?.status === "error" && (
        <span className="text-[11px] text-red-400">{submitted.message}</span>
      )}
    </div>
  )
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {item.source ?? "news"}
          </span>
          {item.date && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {item.date}
            </span>
          )}
        </div>
        <div className="text-sm font-semibold leading-snug">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-400 hover:underline underline-offset-4"
            >
              {item.title ?? "Untitled"}
            </a>
          ) : (
            (item.title ?? "Untitled")
          )}
        </div>
        {item.summary && (
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
            {item.summary}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function LitigationCard({ item }: { item: LitigationItem }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40">
            Litigation
          </Badge>
          {item.filed_date && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {item.filed_date}
            </span>
          )}
        </div>
        <div className="text-sm font-semibold leading-snug">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-amber-300 hover:underline underline-offset-4"
            >
              {item.case_name ?? "Case"}
            </a>
          ) : (
            (item.case_name ?? "Case")
          )}
        </div>
        {item.court && (
          <div className="text-[11px] text-muted-foreground">{item.court}</div>
        )}
        {item.summary && (
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
            {item.summary}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function MgmtCard({ item }: { item: ManagementChange }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[10px]">
            {item.change_type ?? "Change"}
          </Badge>
          {item.date && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {item.date}
            </span>
          )}
        </div>
        <div className="text-sm font-semibold">{item.name ?? "—"}</div>
        {item.role && (
          <div className="text-[11px] text-muted-foreground">{item.role}</div>
        )}
        {item.summary && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-3">
            {item.summary}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function SponsorBlock({ sponsor }: { sponsor: any }) {
  if (typeof sponsor === "string") {
    return <div className="text-sm">{sponsor}</div>
  }
  if (typeof sponsor !== "object" || sponsor === null) return null
  const entries = Object.entries(sponsor).filter(
    ([, v]) => v != null && String(v).length > 0,
  )
  if (entries.length === 0) return null
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {k.replace(/_/g, " ")}
          </dt>
          <dd className="text-sm">{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}
