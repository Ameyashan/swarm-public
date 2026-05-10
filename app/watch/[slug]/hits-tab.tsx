"use client"

import { motion } from "framer-motion"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { SeverityRing } from "@/components/charts/SeverityRing"
import {
  type DetectorHit,
  DETECTOR_LABELS,
  severityTier,
  severityBadgeClass,
  formatSeverity,
  summarize,
  sourceFilingUrl,
  fundTickerLabel,
} from "@/app/alerts/alerts-helpers"

type Props = {
  hits: DetectorHit[]
}

export function HitsTab({ hits }: Props) {
  if (hits.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-lg border border-dashed border-border bg-[#0F1623] py-16 text-center"
      >
        <div className="text-muted-foreground">
          No detectors have fired on this borrower yet.
        </div>
      </motion.div>
    )
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div
        aria-hidden
        className="absolute left-[calc(50%-0.5px)] top-0 h-full w-px bg-border md:block hidden"
      />
      <div
        aria-hidden
        className="absolute left-4 top-0 h-full w-px bg-border md:hidden"
      />

      <ol className="flex flex-col gap-6">
        {hits.map((hit, i) => {
          const side = i % 2 === 0 ? "left" : "right"
          return (
            <motion.li
              key={hit.id}
              initial={{ opacity: 0, x: side === "left" ? -24 : 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="relative grid grid-cols-1 md:grid-cols-2 md:gap-8"
            >
              {/* Dot on the line */}
              <span
                aria-hidden
                className="absolute left-4 top-4 h-3 w-3 -translate-x-[5px] rounded-full bg-blue-500 ring-4 ring-[#0A0E1A] md:left-1/2 md:-translate-x-1/2"
              />

              {/* Card on alternating side */}
              <div
                className={`pl-10 md:pl-0 ${
                  side === "left"
                    ? "md:col-start-1 md:pr-8 md:text-right"
                    : "md:col-start-2 md:pl-8"
                }`}
              >
                <HitCard hit={hit} alignRight={side === "left"} />
              </div>
            </motion.li>
          )
        })}
      </ol>
    </div>
  )
}

function HitCard({
  hit,
  alignRight,
}: {
  hit: DetectorHit
  alignRight: boolean
}) {
  const tier = severityTier(hit.detector_name, hit.severity_score)
  const sourceUrl = sourceFilingUrl(hit)
  const dateStr = hit.current_period_end
    ? format(new Date(hit.current_period_end + "T00:00:00"), "MMM d, yyyy")
    : format(new Date(hit.created_at), "MMM d, yyyy")
  return (
    <div className="rounded-lg border border-border bg-[#0F1623] p-4 shadow-md md:hover:border-blue-500/40 transition-colors">
      <div
        className={`flex items-center gap-3 ${
          alignRight ? "md:flex-row-reverse" : ""
        }`}
      >
        <SeverityRing
          severity={hit.severity_score ?? 0}
          size={44}
          ariaLabel={`Severity ${formatSeverity(hit.detector_name, hit.severity_score)}`}
        />
        <div className={alignRight ? "md:text-right" : ""}>
          <div className="font-semibold">
            {DETECTOR_LABELS[hit.detector_name] ?? hit.detector_name}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {dateStr} · {fundTickerLabel(hit)}
          </div>
        </div>
      </div>
      <div
        className={`mt-3 text-sm leading-relaxed text-foreground/90 ${
          alignRight ? "md:text-right" : ""
        }`}
      >
        {summarize(hit)}
      </div>
      <div
        className={`mt-3 flex flex-wrap items-center gap-2 ${
          alignRight ? "md:justify-end" : ""
        }`}
      >
        <Badge className={severityBadgeClass(tier)}>
          {formatSeverity(hit.detector_name, hit.severity_score)}
        </Badge>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-blue-400 underline-offset-4 hover:underline"
          >
            View source filing →
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">No source link</span>
        )}
      </div>
    </div>
  )
}
