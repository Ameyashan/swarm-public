"use client"

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts"

export type SparklinePoint = { x: string | number; y: number }

type Props = {
  data: SparklinePoint[]
  color?: string
  /** Default 40px. */
  height?: number
  /** Default 120px. The chart is rendered inside a fixed-width container so it
   *  can sit cleanly next to text — pass `null` (or omit) to fall back to 100% width. */
  width?: number | null
  /** Optional formatter applied to tooltip values. */
  formatValue?: (n: number) => string
  /** Optional formatter applied to tooltip labels. */
  formatLabel?: (x: string | number) => string
  /** When true, hide the last-point dot (e.g. for very dense series). */
  hideLastDot?: boolean
  /** When true, animate the line drawing on mount. Default true. */
  animate?: boolean
  className?: string
}

/**
 * Compact line chart with no axes / no grid — just the line and a small dot
 * highlighting the last point. Animates the line drawing on mount via Recharts'
 * `isAnimationActive` so the chart "draws in" the first time it's rendered.
 *
 * For empty / single-point series we render a dim placeholder bar so the layout
 * never collapses.
 */
export function Sparkline({
  data,
  color = "#3B82F6",
  height = 40,
  width = 120,
  formatValue,
  formatLabel,
  hideLastDot,
  animate = true,
  className,
}: Props) {
  const points = (data ?? []).filter(
    (d): d is SparklinePoint =>
      d != null && Number.isFinite(Number(d.y)),
  )

  if (points.length === 0) {
    return (
      <div
        aria-hidden
        className={
          "flex items-center justify-center rounded-md border border-default bg-elevated text-[10px] font-mono uppercase tracking-wider text-dim " +
          (className ?? "")
        }
        style={{ height, width: width ?? "100%" }}
      >
        no data
      </div>
    )
  }

  const lastIndex = points.length - 1

  const chart = (
    <LineChart data={points} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
      {/* Hidden Y axis with padding so the line never clips at the top/bottom. */}
      <YAxis hide domain={["auto", "auto"]} />
      <Tooltip
        cursor={false}
        contentStyle={{
          background: "#0F1623",
          border: "1px solid #1F2937",
          borderRadius: 6,
          fontSize: 11,
          padding: "4px 8px",
          color: "#F3F4F6",
        }}
        labelStyle={{ color: "#9CA3AF" }}
        labelFormatter={(label) =>
          formatLabel ? formatLabel(label as string | number) : String(label)
        }
        formatter={(value: any) => [
          formatValue ? formatValue(Number(value)) : String(value),
          "",
        ]}
      />
      <Line
        type="monotone"
        dataKey="y"
        stroke={color}
        strokeWidth={2}
        isAnimationActive={animate}
        animationDuration={900}
        animationEasing="ease-out"
        dot={(props: any) => {
          const { index, cx, cy } = props
          if (hideLastDot) return <></>
          if (index !== lastIndex) return <></>
          return (
            <circle
              key={`spark-last-${index}`}
              cx={cx}
              cy={cy}
              r={3}
              fill={color}
              stroke="#0A0E1A"
              strokeWidth={1.5}
            />
          )
        }}
        activeDot={{ r: 3.5, fill: color, stroke: "#0A0E1A", strokeWidth: 1.5 }}
      />
    </LineChart>
  )

  return (
    <div
      className={className}
      style={{ height, width: width ?? "100%" }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {chart}
      </ResponsiveContainer>
    </div>
  )
}
