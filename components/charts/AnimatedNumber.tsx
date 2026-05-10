"use client"

import { motion } from "framer-motion"
import CountUp from "react-countup"

type Props = {
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  /** CountUp duration in seconds. Default 1.5s. */
  duration?: number
  className?: string
  /** Optional label rendered below the number. */
  label?: string
  /** Override the className applied to the number itself. */
  numberClassName?: string
}

/**
 * Wraps `react-countup` with a subtle Framer Motion scale-in (0.95 → 1 over
 * 300ms) on first mount. Use anywhere a "feature" number deserves a tiny bit
 * of polish — hero KPIs, alert detail headers, fund summary cards, etc.
 */
export function AnimatedNumber({
  value,
  prefix,
  suffix,
  decimals = 0,
  duration = 1.5,
  className,
  label,
  numberClassName,
}: Props) {
  const safeValue = Number.isFinite(value) ? value : 0

  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      className={className}
    >
      <span
        className={
          numberClassName ??
          "inline-flex items-baseline gap-0.5 font-semibold tabular-nums"
        }
      >
        {prefix && <span className="text-muted">{prefix}</span>}
        <CountUp
          end={safeValue}
          duration={duration}
          decimals={decimals}
          separator=","
        />
        {suffix && <span className="text-muted">{suffix}</span>}
      </span>
      {label && (
        <div className="mt-1 text-xs uppercase tracking-wider text-dim">
          {label}
        </div>
      )}
    </motion.div>
  )
}
