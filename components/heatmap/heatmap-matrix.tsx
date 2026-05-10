"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"

export type HeatmapCellHit = {
  id: string
  detector: string
  detectorLabel: string
  borrower: string
  severityLabel: string
  severityScore: number
}

export type HeatmapCell = {
  fund: string
  /** ISO date for the start of the quarter, e.g. "2025-04-01". */
  quarterStart: string
  /** Quarter label, e.g. "Q2 '25". */
  quarterLabel: string
  hitCount: number
  severityWeighted: number
  topHits: HeatmapCellHit[]
}

export type HeatmapRow = {
  fund: string
  totalFvB: number
  cells: HeatmapCell[]
}

type Props = {
  rows: HeatmapRow[]
  /** Quarter labels, oldest left → newest right. */
  quarterLabels: string[]
  /** Max severity-weighted value across all cells (drives color ramp). */
  maxSeverity: number
}

/**
 * Map a 0..1 intensity to an HSL color from neutral grey → red.
 *  - 0    → #1F2937 (border-default)
 *  - 0.0+ → cool blue-grey, ramping to severity-orange/red as t → 1.
 */
function cellColor(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return "rgba(31, 41, 55, 0.45)" // #1F2937 @ 45%
  // Hue: 220 (slate blue) → 0 (red). Saturation 30→85. Lightness 18→52.
  const clamped = Math.min(1, t)
  // Smooth easing so middling values feel meaningful.
  const eased = Math.pow(clamped, 0.7)
  const hue = 220 - 220 * eased
  const sat = 30 + 55 * eased
  const light = 18 + 34 * eased
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`
}

function textColor(t: number): string {
  if (!Number.isFinite(t) || t <= 0.05) return "#6B7280" // text-dim
  if (t < 0.35) return "#9CA3AF" // text-muted
  return "#F3F4F6" // text-default
}

function buildAlertsHref(fund: string, quarterStart: string): string {
  const params = new URLSearchParams()
  params.set("fund", fund)
  params.set("quarter", quarterStart)
  return `/alerts?${params.toString()}`
}

export function HeatmapMatrix({ rows, quarterLabels, maxSeverity }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const safeMax = Math.max(maxSeverity, 0.001)
  const cols = quarterLabels.length

  return (
    <div className="overflow-x-auto rounded-xl border border-default bg-card p-4">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `170px repeat(${cols}, minmax(64px, 1fr))`,
          rowGap: 8,
          columnGap: 6,
        }}
      >
        {/* Header row */}
        <div className="text-[11px] font-mono uppercase tracking-wider text-dim">
          Fund · latest FV
        </div>
        {quarterLabels.map((q) => (
          <div
            key={q}
            className="text-center text-[11px] font-mono uppercase tracking-wider text-dim"
          >
            {q}
          </div>
        ))}

        {/* Data rows */}
        {rows.map((row, rowIdx) => (
          <FundRow
            key={row.fund}
            row={row}
            rowIdx={rowIdx}
            cols={cols}
            safeMax={safeMax}
            hoveredKey={hovered}
            setHovered={setHovered}
          />
        ))}
      </div>
    </div>
  )
}

function FundRow({
  row,
  rowIdx,
  cols,
  safeMax,
  hoveredKey,
  setHovered,
}: {
  row: HeatmapRow
  rowIdx: number
  cols: number
  safeMax: number
  hoveredKey: string | null
  setHovered: (k: string | null) => void
}) {
  return (
    <>
      <div className="flex items-center justify-between pr-2">
        <Link
          href={`/funds/${row.fund}`}
          className="font-mono text-sm font-semibold text-default hover:text-accent"
        >
          {row.fund}
        </Link>
        <span className="text-[10px] font-mono text-dim">
          {row.totalFvB > 0 ? `$${row.totalFvB.toFixed(1)}B` : "—"}
        </span>
      </div>
      {row.cells.map((cell, colIdx) => {
        const t = safeMax > 0 ? cell.severityWeighted / safeMax : 0
        const key = `${row.fund}|${cell.quarterStart}`
        const isHovered = hoveredKey === key
        const orderIndex = rowIdx * cols + colIdx
        return (
          <motion.div
            key={key}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.22,
              delay: orderIndex * 0.03,
              ease: [0.32, 0.72, 0, 1],
            }}
            className="relative"
            onMouseEnter={() => setHovered(key)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(key)}
            onBlur={() => setHovered(null)}
          >
            <Link
              href={buildAlertsHref(row.fund, cell.quarterStart)}
              className="group relative flex h-12 items-center justify-center rounded-md border border-default text-sm font-semibold tabular-nums transition-transform hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{
                background: cellColor(t),
                color: textColor(t),
              }}
              aria-label={`${row.fund} ${cell.quarterLabel}: ${cell.hitCount} hits, severity ${cell.severityWeighted.toFixed(2)}`}
            >
              {cell.hitCount > 0 ? cell.hitCount : ""}
            </Link>

            {isHovered && (
              <div
                className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-md border border-default bg-elevated p-3 text-xs shadow-xl"
                role="tooltip"
              >
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-dim">
                    {row.fund} · {cell.quarterLabel}
                  </span>
                  <span className="font-mono text-[11px] text-default">
                    {cell.hitCount} {cell.hitCount === 1 ? "hit" : "hits"}
                  </span>
                </div>
                {cell.topHits.length === 0 ? (
                  <p className="text-dim">No hits in this quarter.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {cell.topHits.map((h) => (
                      <li
                        key={h.id}
                        className="flex items-baseline justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-default">
                            {h.borrower}
                          </div>
                          <div className="text-[10px] font-mono uppercase tracking-wider text-dim">
                            {h.detectorLabel}
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-severity-high">
                          {h.severityLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 text-[10px] text-dim">
                  Click → /alerts filtered to this fund-quarter
                </div>
              </div>
            )}
          </motion.div>
        )
      })}
    </>
  )
}

/**
 * Horizontal legend showing the cell color ramp.
 */
export function HeatmapLegend({ maxSeverity }: { maxSeverity: number }) {
  const stops = 12
  return (
    <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-wider text-dim">
      <span>Less severe</span>
      <div className="flex h-4 overflow-hidden rounded-md border border-default">
        {Array.from({ length: stops }).map((_, i) => {
          const t = i / (stops - 1)
          return (
            <div
              key={i}
              className="h-full w-6"
              style={{ background: cellColor(t) }}
              aria-hidden
            />
          )
        })}
      </div>
      <span>
        More severe
        <span className="ml-2 normal-case text-default">
          (max Σ|severity| ≈ {maxSeverity.toFixed(1)})
        </span>
      </span>
    </div>
  )
}
