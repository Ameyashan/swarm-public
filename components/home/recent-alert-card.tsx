"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import {
  DETECTOR_LABELS,
  type DetectorHit,
  summarize,
  sourceFilingUrl,
  fundTickerLabel,
  companyLabel,
  formatSeverity,
} from "@/app/alerts/alerts-helpers"
import { SeverityRing } from "@/components/charts/SeverityRing"
import { HitSparkline } from "@/components/charts/HitSparkline"
import type { SparklinePoint } from "@/components/charts/Sparkline"

export function RecentAlertCard({
  hit,
  index,
  series,
}: {
  hit: DetectorHit
  index: number
  series?: SparklinePoint[]
}) {
  const filingUrl = sourceFilingUrl(hit)
  const data = series ?? []

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
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SeverityRing
            severity={hit.severity_score ?? 0}
            size={36}
            ariaLabel={`Severity ${formatSeverity(hit.detector_name, hit.severity_score)}`}
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] font-mono uppercase tracking-wider text-dim">
              {DETECTOR_LABELS[hit.detector_name] ?? hit.detector_name}
              {" · "}
              {fundTickerLabel(hit)}
            </div>
            <div className="text-sm font-medium text-default">
              {companyLabel(hit)}
            </div>
            <p className="mt-1 text-sm text-muted">{summarize(hit)}</p>
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
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <HitSparkline
            detector={hit.detector_name}
            data={data}
            width={160}
            height={44}
          />
          <span className="text-[10px] font-mono uppercase tracking-wider text-dim">
            {hit.detector_name === "pik_creep" ? "PIK share · 8q" : "FV · 8q"}
          </span>
        </div>
      </div>
    </motion.div>
  )
}
