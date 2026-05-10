"use client"

import { format } from "date-fns"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

export type FvHistoryRow = {
  period_end: string
  /** Fair value in $thousands. */
  fv_thousands: number
}

type Props = {
  data: FvHistoryRow[]
  /** Total chart height in px. Default 300. */
  height?: number
  /** Line color. Default accent blue. */
  color?: string
  /** Optional title rendered above the chart. */
  title?: string
}

import { formatFV } from "@/lib/format"

// Caller is expected to normalize values to whole dollars before passing in
// (see /lib/format.ts:toDollars). The legacy "fv_thousands" prop name is
// kept only for back-compat — values may now arrive at any unified scale.
function fmtUsd(value: number): string {
  return formatFV(value)
}

function fmtMonth(s: string): string {
  try {
    return format(new Date(s), "MMM yy")
  } catch {
    return s
  }
}

function fmtMonthLong(s: string): string {
  try {
    return format(new Date(s), "MMM d, yyyy")
  } catch {
    return s
  }
}

/**
 * Full-size fair-value history line chart. Used on the alert detail page to
 * show a borrower's FV trajectory across all funds. Animates the line drawing
 * on mount via Recharts' `isAnimationActive`.
 */
export function FvHistoryChart({
  data,
  height = 300,
  color = "#3B82F6",
  title,
}: Props) {
  const sorted = [...(data ?? [])]
    .filter((d) => d?.period_end && Number.isFinite(Number(d.fv_thousands)))
    .sort((a, b) => a.period_end.localeCompare(b.period_end))
    .map((d) => ({
      period_end: d.period_end,
      fv_thousands: Number(d.fv_thousands),
    }))

  if (sorted.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-default bg-elevated text-xs font-mono uppercase tracking-wider text-dim"
        style={{ height }}
      >
        No history available
      </div>
    )
  }

  return (
    <div className="w-full">
      {title && (
        <div className="mb-2 text-xs font-mono uppercase tracking-wider text-dim">
          {title}
        </div>
      )}
      <div style={{ height, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={sorted}
            margin={{ top: 12, right: 16, bottom: 8, left: 8 }}
          >
            <CartesianGrid stroke="#1F2937" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="period_end"
              tickFormatter={fmtMonth}
              stroke="#6B7280"
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
              tickLine={false}
              axisLine={{ stroke: "#1F2937" }}
              minTickGap={24}
            />
            <YAxis
              stroke="#6B7280"
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
              tickFormatter={(v: number) => fmtUsd(v)}
              tickLine={false}
              axisLine={{ stroke: "#1F2937" }}
              width={60}
            />
            <Tooltip
              cursor={{ stroke: "#1F2937", strokeWidth: 1 }}
              contentStyle={{
                background: "#0F1623",
                border: "1px solid #1F2937",
                borderRadius: 6,
                fontSize: 12,
                padding: "6px 10px",
                color: "#F3F4F6",
              }}
              labelStyle={{ color: "#9CA3AF", marginBottom: 2 }}
              labelFormatter={(label) => fmtMonthLong(String(label))}
              formatter={(value: any) => [fmtUsd(Number(value)), "Fair value"]}
            />
            <Line
              type="monotone"
              dataKey="fv_thousands"
              stroke={color}
              strokeWidth={2}
              isAnimationActive
              animationDuration={1100}
              animationEasing="ease-out"
              dot={{ r: 2.5, fill: color, stroke: "#0A0E1A", strokeWidth: 1 }}
              activeDot={{
                r: 4.5,
                fill: color,
                stroke: "#0A0E1A",
                strokeWidth: 1.5,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
