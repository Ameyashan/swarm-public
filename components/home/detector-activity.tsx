"use client"

import { motion } from "framer-motion"
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts"

export type DetectorSeries = {
  detector: "mark_drift_down" | "pik_creep" | "cross_fund_divergence"
  label: string
  description: string
  color: string
  data: { quarter: string; hits: number }[]
}

function MiniChart({ series }: { series: DetectorSeries }) {
  const total = series.data.reduce((acc, d) => acc + d.hits, 0)
  const last = series.data[series.data.length - 1]?.hits ?? 0
  const prev = series.data[series.data.length - 2]?.hits ?? 0
  const delta = last - prev

  return (
    <motion.div
      className="rounded-xl border border-default bg-card p-5"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-default">
            {series.label}
          </div>
          <div className="mt-0.5 text-xs text-dim">{series.description}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold tabular-nums text-default">
            {total}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-dim">
            hits · 8q
          </div>
        </div>
      </div>

      <div className="mt-4 h-[100px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={series.data}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          >
            <XAxis
              dataKey="quarter"
              tick={{ fill: "#6B7280", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <Tooltip
              cursor={{ fill: "rgba(59,130,246,0.08)" }}
              contentStyle={{
                background: "#0F1623",
                border: "1px solid #1F2937",
                borderRadius: 8,
                fontSize: 12,
                color: "#F3F4F6",
              }}
              labelStyle={{ color: "#9CA3AF" }}
            />
            <Bar dataKey="hits" radius={[3, 3, 0, 0]}>
              {series.data.map((_, idx) => (
                <Cell
                  key={idx}
                  fill={series.color}
                  fillOpacity={
                    idx === series.data.length - 1 ? 1 : 0.55
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-dim">Latest quarter</span>
        <span className="font-mono tabular-nums text-default">
          {last} hits{" "}
          <span
            className={
              delta > 0
                ? "text-severity-critical"
                : delta < 0
                ? "text-status-accrual"
                : "text-dim"
            }
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} {Math.abs(delta)}
          </span>
        </span>
      </div>
    </motion.div>
  )
}

export function DetectorActivity({ series }: { series: DetectorSeries[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {series.map((s) => (
        <MiniChart key={s.detector} series={s} />
      ))}
    </div>
  )
}
