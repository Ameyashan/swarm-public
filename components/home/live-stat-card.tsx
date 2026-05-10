"use client"

import { motion } from "framer-motion"
import CountUp from "react-countup"

type Props = {
  /** Numeric value the CountUp should animate to. */
  value: number
  /** Decimal places passed to CountUp. */
  decimals?: number
  /** Prefix shown alongside the count, e.g. "$". */
  prefix?: string
  /** Suffix shown alongside the count, e.g. "B" or "%". */
  suffix?: string
  /** Bottom-left label, e.g. "monitored". */
  label: string
  /** Optional context line under the label. */
  sublabel?: string
  /** Optional accent color for the pulsing border. */
  accentRgb?: string
}

/**
 * Hero stat card with:
 *   - CountUp animating from 0 to `value` over 1.5s on mount
 *   - Subtle pulsing border (4s loop, opacity 0.3 → 0.6 → 0.3) via Framer Motion
 */
export function LiveStatCard({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  label,
  sublabel,
  accentRgb = "59, 130, 246", // accent blue
}: Props) {
  return (
    <div className="relative">
      {/* Pulsing border layer */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{
          boxShadow: `0 0 0 1px rgba(${accentRgb}, 0.6), 0 0 24px 0 rgba(${accentRgb}, 0.25)`,
        }}
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Card body */}
      <div className="relative h-full rounded-xl border border-default bg-card px-6 py-7 sm:px-7 sm:py-8">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-dim">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: `rgb(${accentRgb})` }}
          />
          Live
        </div>

        <div className="mt-3 flex items-baseline gap-1 font-semibold tabular-nums text-default">
          {prefix && (
            <span className="text-3xl sm:text-4xl text-muted">{prefix}</span>
          )}
          <span className="text-4xl sm:text-5xl tracking-tight">
            <CountUp
              end={value}
              duration={1.5}
              decimals={decimals}
              separator=","
            />
          </span>
          {suffix && (
            <span className="text-3xl sm:text-4xl text-muted">{suffix}</span>
          )}
        </div>

        <div className="mt-3 text-sm font-medium text-default">{label}</div>
        {sublabel && (
          <div className="mt-1 text-xs text-dim">{sublabel}</div>
        )}
      </div>
    </div>
  )
}
