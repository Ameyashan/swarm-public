"use client"

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts"
import Link from "next/link"
import { motion } from "framer-motion"
import { format } from "date-fns"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DETECTOR_LABELS,
  type DetectorHit,
} from "@/app/alerts/alerts-helpers"
import { fmtUsdFromThousands, fmtPct, fmtPeriodShort } from "./format"

export type FundSummary = {
  ticker: string
  firstPeriod: string
  latestPeriod: string
  latestFv: number | null
  latestCost: number | null
  latestAccrual: string | null
  series: Array<{ period: string; fv: number | null; cost: number | null }>
  latestHit: DetectorHit | null
}

type Props = {
  fundSummaries: FundSummary[]
}

export function ByFundTab({ fundSummaries }: Props) {
  // Shared y-axis: max FV across all funds (in millions)
  let yMax = 0
  for (const s of fundSummaries) {
    for (const r of s.series) {
      if (r.fv != null) yMax = Math.max(yMax, r.fv)
    }
  }
  const yMaxM = (yMax / 1000) * 1.1 // 10% headroom

  // Detect outlier: any fund whose latest FV/cost % differs from the median
  // by more than 10pp.
  const ratios = fundSummaries
    .map((s) =>
      s.latestFv != null && s.latestCost != null && s.latestCost > 0
        ? s.latestFv / s.latestCost
        : null,
    )
    .filter((r): r is number => r !== null)
    .sort((a, b) => a - b)
  const median =
    ratios.length === 0
      ? null
      : ratios.length % 2 === 1
        ? ratios[(ratios.length - 1) / 2]
        : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2
  function isOutlier(s: FundSummary): boolean {
    if (median == null) return false
    if (s.latestFv == null || s.latestCost == null || s.latestCost <= 0)
      return false
    return Math.abs(s.latestFv / s.latestCost - median) > 0.1
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-8"
    >
      {/* Small multiples */}
      <Card>
        <CardHeader>
          <CardTitle>Per-fund history</CardTitle>
          <CardDescription>
            Same y-axis across all funds — taller bars = bigger position.
            Outliers (different mark) are highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`grid gap-4 ${
              fundSummaries.length === 1
                ? "grid-cols-1"
                : fundSummaries.length === 2
                  ? "grid-cols-1 sm:grid-cols-2"
                  : fundSummaries.length === 3
                    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            }`}
          >
            {fundSummaries.map((s, i) => (
              <MiniChart
                key={s.ticker}
                summary={s}
                yMaxM={yMaxM}
                outlier={isOutlier(s)}
                index={i}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Comparison table */}
      <Card>
        <CardHeader>
          <CardTitle>Fund comparison</CardTitle>
          <CardDescription>
            Latest mark, accrual, and drift since each fund first held the
            position.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fund</TableHead>
                <TableHead className="text-right">Latest FV</TableHead>
                <TableHead className="text-right">Latest cost</TableHead>
                <TableHead className="text-right">FV / cost</TableHead>
                <TableHead>Accrual</TableHead>
                <TableHead>Latest detector hit</TableHead>
                <TableHead className="text-right">
                  Mark drift since first hold
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fundSummaries.map((s) => {
                const ratio =
                  s.latestFv != null && s.latestCost != null && s.latestCost > 0
                    ? s.latestFv / s.latestCost
                    : null
                // Mark drift since first hold
                const first = s.series.find((r) => r.fv != null && r.cost != null)
                const firstRatio =
                  first && first.cost && first.cost > 0
                    ? (first.fv as number) / (first.cost as number)
                    : null
                const driftPP =
                  ratio != null && firstRatio != null ? ratio - firstRatio : null
                return (
                  <TableRow key={s.ticker}>
                    <TableCell className="font-mono font-semibold">
                      {s.ticker}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtUsdFromThousands(s.latestFv)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtUsdFromThousands(s.latestCost)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        ratio != null && ratio < 0.9
                          ? "text-red-400"
                          : ratio != null && ratio > 1.05
                            ? "text-emerald-400"
                            : ""
                      }`}
                    >
                      {ratio == null ? "—" : `${(ratio * 100).toFixed(1)}%`}
                    </TableCell>
                    <TableCell>
                      <AccrualBadge status={s.latestAccrual} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.latestHit ? (
                        <div>
                          <div className="font-medium">
                            {DETECTOR_LABELS[s.latestHit.detector_name] ??
                              s.latestHit.detector_name}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {s.latestHit.current_period_end
                              ? format(
                                  new Date(
                                    s.latestHit.current_period_end + "T00:00:00",
                                  ),
                                  "MMM yyyy",
                                )
                              : "—"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        driftPP != null && driftPP < -0.05
                          ? "text-red-400"
                          : driftPP != null && driftPP > 0.05
                            ? "text-emerald-400"
                            : ""
                      }`}
                    >
                      {driftPP == null
                        ? "—"
                        : `${driftPP > 0 ? "+" : ""}${(driftPP * 100).toFixed(1)}pp`}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function MiniChart({
  summary,
  yMaxM,
  outlier,
  index,
}: {
  summary: FundSummary
  yMaxM: number
  outlier: boolean
  index: number
}) {
  const data = summary.series.map((r) => ({
    label: fmtPeriodShort(r.period),
    fv: r.fv != null ? r.fv / 1000 : null,
  }))
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className={`rounded-lg border p-3 ${
        outlier
          ? "border-amber-500/60 bg-amber-500/5"
          : "border-border bg-[#0F1623]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-sm font-semibold">{summary.ticker}</div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {fmtUsdFromThousands(summary.latestFv)}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <AccrualBadge status={summary.latestAccrual} small />
        {outlier && (
          <Badge
            variant="outline"
            className="border-amber-500/60 text-[10px] text-amber-300"
          >
            Outlier mark
          </Badge>
        )}
      </div>
      <div className="mt-3 h-[100px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient
                id={`mini-grad-${summary.ticker}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={outlier ? "#F59E0B" : "#3B82F6"}
                  stopOpacity={0.6}
                />
                <stop
                  offset="100%"
                  stopColor={outlier ? "#F59E0B" : "#3B82F6"}
                  stopOpacity={0.05}
                />
              </linearGradient>
            </defs>
            <YAxis domain={[0, yMaxM]} hide />
            <XAxis
              dataKey="label"
              tick={{ fill: "#6B7280", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <Tooltip
              cursor={{ stroke: "#374151", strokeDasharray: "2 2" }}
              contentStyle={{
                background: "#0F1623",
                border: "1px solid #1F2937",
                borderRadius: 6,
                fontSize: 11,
              }}
              labelStyle={{ color: "#9CA3AF" }}
              formatter={(v: any) => [`$${Number(v).toFixed(2)}M`, "FV"]}
            />
            <Area
              type="monotone"
              dataKey="fv"
              stroke={outlier ? "#F59E0B" : "#3B82F6"}
              strokeWidth={1.5}
              fill={`url(#mini-grad-${summary.ticker})`}
              isAnimationActive={false}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  )
}

function AccrualBadge({
  status,
  small,
}: {
  status: string | null
  small?: boolean
}) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const isAccrual = status === "accrual"
  return (
    <Badge
      variant="outline"
      className={`${small ? "text-[10px]" : "text-[11px]"} ${
        isAccrual
          ? "border-emerald-500/40 text-emerald-300"
          : "border-red-500/60 text-red-300"
      }`}
    >
      {isAccrual ? "Accrual" : "Non-accrual"}
    </Badge>
  )
}
