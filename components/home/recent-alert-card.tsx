"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import {
  DETECTOR_LABELS,
  type DetectorHit,
  severityTier,
  severityBadgeClass,
  summarize,
  sourceFilingUrl,
  fundTickerLabel,
  companyLabel,
} from "@/app/alerts/alerts-helpers"

export function RecentAlertCard({
  hit,
  index,
}: {
  hit: DetectorHit
  index: number
}) {
  const tier = severityTier(hit.detector_name, hit.severity_score)
  const filingUrl = sourceFilingUrl(hit)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{
        duration: 0.4,
        delay: index * 0.04,
        ease: [0.32, 0.72, 0, 1],
      }}
      className="rounded-xl border border-default bg-card p-4 transition-colors hover:border-hover"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className={severityBadgeClass(tier)}>
              {DETECTOR_LABELS[hit.detector_name] ?? hit.detector_name}
            </Badge>
            <span className="font-mono text-sm text-muted">
              {fundTickerLabel(hit)}
            </span>
            <span className="text-sm font-medium text-default">
              {companyLabel(hit)}
            </span>
          </div>
          <p className="text-sm text-muted">{summarize(hit)}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <Link
              href={`/alerts/${hit.id}`}
              className="text-accent underline-offset-4 hover:underline"
            >
              Alert details →
            </Link>
            {filingUrl && (
              <a
                href={filingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-4 hover:underline"
              >
                View source filing →
              </a>
            )}
          </div>
        </div>

        {/* Sparkline placeholder — real chart wired up next prompt */}
        <div
          aria-hidden
          className="relative h-12 w-full shrink-0 overflow-hidden rounded-md border border-default bg-elevated sm:w-40"
          data-sparkline-placeholder
        >
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono uppercase tracking-wider text-dim">
            sparkline
          </div>
        </div>
      </div>
    </motion.div>
  )
}
