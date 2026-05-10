"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceDot,
} from "recharts"
import { motion } from "framer-motion"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Sparkline } from "@/components/charts/Sparkline"
import type { DetectorHit } from "@/app/alerts/alerts-helpers"
import { DETECTOR_LABELS, summarize } from "@/app/alerts/alerts-helpers"
import { fmtUsdFromThousands, fmtPct, fmtPeriodShort } from "./format"
import { formatFV } from "@/lib/format"
import type { PeriodHits, StackedRow } from "./watch-tabs"

// Distinct colors per fund — colorblind-aware ordering. Cycles if >8.
const FUND_COLORS = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#A855F7", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#F97316", // orange
  "#84CC16", // lime
]

type Props = {
  stackedSeries: StackedRow[]
  fundTickers: string[]
  periodHits: PeriodHits[]
  accrualPct: number | null
  fvOverCostPct: number | null
  driftSeries: Array<{ x: string; y: number }>
  totalHits: number
  latestFvSum: number
  latestCostSum: number
}

export function OverviewTab({
  stackedSeries,
  fundTickers,
  periodHits,
  accrualPct,
  fvOverCostPct,
  driftSeries,
  totalHits,
  latestFvSum,
  latestCostSum,
}: Props) {
  // Convert thousands → millions for display in chart Y axis
  const data = stackedSeries.map((row) => {
    const out: Record<string, number | string> = {
      period: String(row.period),
      label: fmtPeriodShort(String(row.period)),
    }
    let total = 0
    for (const t of fundTickers) {
      const v = Number(row[t] ?? 0) / 1000
      out[t] = v
      total += v
    }
    out.__total = total
    return out
  })

  // Map detector-hit periods → y-coordinate at that period (in millions)
  const hitMarkers = periodHits
    .map(({ period, hits }) => {
      const row = data.find((r) => r.period === period)
      if (!row) return null
      return {
        period,
        label: fmtPeriodShort(period),
        y: Number(row.__total ?? 0),
        hits,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-8"
    >
      {/* Stacked area chart */}
      <Card>
        <CardHeader>
          <CardTitle>Fair value across funds</CardTitle>
          <CardDescription>
            Stacked contribution from each fund holding this borrower. Red dots
            mark periods where detectors fired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 12, right: 16, left: 0, bottom: 8 }}
              >
                <defs>
                  {fundTickers.map((t, i) => (
                    <linearGradient
                      key={t}
                      id={`grad-${t}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={FUND_COLORS[i % FUND_COLORS.length]}
                        stopOpacity={0.7}
                      />
                      <stop
                        offset="100%"
                        stopColor={FUND_COLORS[i % FUND_COLORS.length]}
                        stopOpacity={0.15}
                      />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#1F2937"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  axisLine={{ stroke: "#1F2937" }}
                  tickLine={{ stroke: "#1F2937" }}
                />
                <YAxis
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  axisLine={{ stroke: "#1F2937" }}
                  tickLine={{ stroke: "#1F2937" }}
                  tickFormatter={(v) => formatFV(Number(v))}
                  width={60}
                />
                <Tooltip content={<StackedTooltip periodHits={periodHits} />} />
                {fundTickers.map((t, i) => (
                  <Area
                    key={t}
                    type="monotone"
                    dataKey={t}
                    stackId="1"
                    stroke={FUND_COLORS[i % FUND_COLORS.length]}
                    strokeWidth={1.5}
                    fill={`url(#grad-${t})`}
                    isAnimationActive
                    animationDuration={600}
                  />
                ))}
                {hitMarkers.map((m, i) => (
                  <ReferenceDot
                    key={`hit-${m.period}-${i}`}
                    x={m.label}
                    y={m.y}
                    r={5}
                    fill="#EF4444"
                    stroke="#0A0E1A"
                    strokeWidth={2}
                    ifOverflow="visible"
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {fundTickers.map((t, i) => (
              <div key={t} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{
                    backgroundColor: FUND_COLORS[i % FUND_COLORS.length],
                  }}
                />
                <span className="font-mono">{t}</span>
              </div>
            ))}
            <div className="ml-2 flex items-center gap-1.5 text-muted-foreground">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-red-500"
              />
              Detector fired
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4 stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DonutCard
          label="Accrual %"
          pct={accrualPct}
          subtitle="latest period"
        />
        <GaugeCard
          label="Mark vs cost"
          ratio={fvOverCostPct}
          fvSum={latestFvSum}
          costSum={latestCostSum}
        />
        <SparkCard label="Drift (last 4q)" series={driftSeries} />
        <CountCard label="Detector hits ever" count={totalHits} />
      </div>
    </motion.div>
  )
}

function StackedTooltip(props: any) {
  const { active, payload, label } = props
  const periodHits = props.periodHits as PeriodHits[]
  if (!active || !payload || payload.length === 0) return null
  // payload entries are in stack order
  const periodKey =
    payload[0]?.payload?.period ??
    (typeof label === "string" ? label : null)
  const totalM = payload.reduce(
    (s: number, p: any) => s + (Number(p.value) || 0),
    0,
  )
  const hits =
    periodHits.find((p: PeriodHits) => p.period === periodKey)?.hits.slice(0, 3) ?? []

  return (
    <div className="rounded-md border border-border bg-[#0F1623] px-3 py-2 text-xs shadow-lg">
      <div className="font-mono text-[11px] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-semibold tabular-nums">
        Total {formatFV(totalM)}
      </div>
      <div className="mt-2 space-y-0.5">
        {payload
          .slice()
          .reverse()
          .map((p: any) => (
            <div
              key={p.dataKey}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: p.color }}
                />
                <span className="font-mono">{p.dataKey}</span>
              </span>
              <span className="tabular-nums">
                {formatFV(Number(p.value))}
              </span>
            </div>
          ))}
      </div>
      {hits.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Detectors fired
          </div>
          {hits.map((h: DetectorHit) => (
            <div key={h.id} className="leading-snug">
              <span className="font-medium text-red-400">
                {DETECTOR_LABELS[h.detector_name] ?? h.detector_name}
              </span>{" "}
              <span className="text-muted-foreground">{summarize(h)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DonutCard({
  label,
  pct,
  subtitle,
}: {
  label: string
  pct: number | null
  subtitle: string
}) {
  const value = pct == null ? 0 : Math.max(0, Math.min(1, pct))
  const size = 80
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = c * value
  const color = value >= 0.999 ? "#10B981" : value >= 0.5 ? "#FBBF24" : "#EF4444"
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <svg width={size} height={size} aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#1F2937"
            strokeWidth={stroke}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            initial={{ strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${dash} ${c - dash}` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
          <text
            x={size / 2}
            y={size / 2 + 4}
            textAnchor="middle"
            className="fill-foreground"
            fontSize={14}
            fontWeight={600}
          >
            {pct == null ? "—" : fmtPct(pct, 0)}
          </text>
        </svg>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function GaugeCard({
  label,
  ratio,
  fvSum,
  costSum,
}: {
  label: string
  ratio: number | null
  fvSum: number
  costSum: number
}) {
  // Gauge: -50% .. +50% around 1.0 (i.e. clamp ratio between 0.5 and 1.5)
  const r = ratio == null ? 1 : Math.max(0.5, Math.min(1.5, ratio))
  // Map to 0..1 sweep
  const sweep = (r - 0.5) / 1.0
  const angle = -90 + sweep * 180 // -90 (left) → +90 (right)
  const color =
    ratio == null
      ? "#6B7280"
      : ratio >= 1
        ? "#10B981"
        : ratio >= 0.9
          ? "#FBBF24"
          : "#EF4444"
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <svg width={96} height={64} viewBox="0 0 96 64" aria-hidden>
          {/* arc background */}
          <path
            d="M 12 56 A 36 36 0 0 1 84 56"
            fill="none"
            stroke="#1F2937"
            strokeWidth={8}
            strokeLinecap="round"
          />
          {/* arc filled */}
          <motion.path
            d={`M 12 56 A 36 36 0 0 1 84 56`}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={113}
            initial={{ strokeDashoffset: 113 }}
            animate={{ strokeDashoffset: 113 * (1 - sweep) }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
          {/* needle */}
          <motion.line
            x1={48}
            y1={56}
            x2={48}
            y2={24}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            initial={{ rotate: -90, originX: 48, originY: 56 }}
            animate={{ rotate: angle, originX: 48, originY: 56 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
          <circle cx={48} cy={56} r={3} fill={color} />
        </svg>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {ratio == null ? "—" : `${(ratio * 100).toFixed(1)}%`}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {fmtUsdFromThousands(fvSum)} / {fmtUsdFromThousands(costSum)}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SparkCard({
  label,
  series,
}: {
  label: string
  series: Array<{ x: string; y: number }>
}) {
  const first = series[0]?.y ?? 0
  const last = series[series.length - 1]?.y ?? 0
  const delta = first > 0 ? (last - first) / first : 0
  const color = delta < -0.05 ? "#EF4444" : delta > 0.05 ? "#10B981" : "#3B82F6"
  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {fmtUsdFromThousands(last)}
            </div>
            <div
              className="text-[11px] tabular-nums"
              style={{ color: delta === 0 ? "#9CA3AF" : color }}
            >
              {delta > 0 ? "+" : ""}
              {(delta * 100).toFixed(1)}% over period
            </div>
          </div>
          <Sparkline
            data={series}
            color={color}
            width={120}
            height={40}
            animate={false}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function CountCard({ label, count }: { label: string; count: number }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{count}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {count === 0
            ? "No detectors fired"
            : count === 1
              ? "1 alert in history"
              : `${count} alerts in history`}
        </div>
      </CardContent>
    </Card>
  )
}
