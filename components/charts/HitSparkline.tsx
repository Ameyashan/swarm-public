"use client"

import { format } from "date-fns"
import { formatFV, formatPct } from "@/lib/format"
import { Sparkline, type SparklinePoint } from "./Sparkline"

type Props = {
  detector: string
  data: SparklinePoint[]
  height?: number
  width?: number | null
  className?: string
}

function fmtDateLabel(x: string | number): string {
  try {
    return format(new Date(String(x)), "MMM yyyy")
  } catch {
    return String(x)
  }
}

/**
 * Detector-aware sparkline:
 *  - mark_drift_down / cross_fund_divergence → borrower FV ($), red line, dim if rising
 *  - pik_creep → fund PIK share (%), amber line
 *  - other → muted blue line
 *
 * For mark-drift / cross-fund we color red when the latest point is below the
 * first point (FV is down), green otherwise.
 */
export function HitSparkline({
  detector,
  data,
  height = 36,
  width = 140,
  className,
}: Props) {
  const isPct = detector === "pik_creep"
  const formatValue = isPct
    ? (n: number) => formatPct(n, { digits: 1 })
    : (n: number) => formatFV(n)

  let color = "#3B82F6"
  if (data.length >= 2) {
    const first = data[0]?.y ?? 0
    const last = data[data.length - 1]?.y ?? 0
    if (isPct) {
      // For PIK creep, rising share is bad → amber/red.
      color = last > first ? "#F59E0B" : "#10B981"
    } else {
      color = last < first ? "#EF4444" : "#10B981"
    }
  } else if (isPct) {
    color = "#F59E0B"
  }

  return (
    <Sparkline
      data={data}
      color={color}
      height={height}
      width={width}
      formatValue={formatValue}
      formatLabel={fmtDateLabel}
      className={className}
    />
  )
}
