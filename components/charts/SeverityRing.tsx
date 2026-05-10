"use client"

import { motion } from "framer-motion"

type Props = {
  /** Severity in 0-1 range. Negative values are accepted (we use absolute value). */
  severity: number
  /** Total ring diameter in px. Default 32. */
  size?: number
  /** Stroke width — defaults to roughly 12% of size. */
  strokeWidth?: number
  /** Override the ring color (otherwise tier-derived). */
  color?: string
  /** Optional inner label override. Default renders `Math.round(severity*100)`%. */
  label?: string
  /** When true, hide the inner numeric label. */
  hideLabel?: boolean
  /** ARIA label, useful when hideLabel is true. */
  ariaLabel?: string
}

const COLORS = {
  critical: "#EF4444",
  high: "#F59E0B",
  medium: "#FBBF24",
  low: "#6B7280",
}

function tierFor(s: number): keyof typeof COLORS {
  const abs = Math.abs(s)
  if (abs > 0.5) return "critical"
  if (abs > 0.3) return "high"
  if (abs > 0.1) return "medium"
  return "low"
}

/**
 * Circular severity ring.
 *
 * The arc length is animated via stroke-dasharray to fill in proportion to
 * `severity`. For severities above 0.5 (critical) we add a slow pulsing glow
 * via Framer Motion (scale 1 → 1.05 → 1, 2s loop).
 */
export function SeverityRing({
  severity,
  size = 32,
  strokeWidth,
  color,
  label,
  hideLabel,
  ariaLabel,
}: Props) {
  const sw = strokeWidth ?? Math.max(3, Math.round(size * 0.12))
  const clamped = Math.min(1, Math.max(0, Math.abs(severity)))
  const tier = tierFor(severity)
  const ringColor = color ?? COLORS[tier]
  const isCritical = tier === "critical"

  // Geometry
  const radius = (size - sw) / 2
  const circumference = 2 * Math.PI * radius
  const filled = circumference * clamped
  const empty = circumference - filled

  const labelText =
    label ?? `${Math.round(clamped * 100)}${label === undefined ? "%" : ""}`

  const fontSize = Math.max(9, Math.round(size * 0.32))

  return (
    <motion.span
      role="img"
      aria-label={
        ariaLabel ?? `Severity ${Math.round(clamped * 100)} percent (${tier})`
      }
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        filter: isCritical
          ? `drop-shadow(0 0 6px ${ringColor}66)`
          : undefined,
      }}
      animate={isCritical ? { scale: [1, 1.05, 1] } : undefined}
      transition={
        isCritical
          ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#1F2937"
          strokeWidth={sw}
        />
        {/* Progress arc — start at 12 o'clock by rotating -90deg around center. */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${empty}`}
          initial={{ strokeDasharray: `0 ${circumference}` }}
          animate={{ strokeDasharray: `${filled} ${empty}` }}
          transition={{ duration: 0.9, ease: [0.32, 0.72, 0, 1] }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {!hideLabel && (
        <span
          className="relative font-mono font-semibold tabular-nums text-default"
          style={{ fontSize, lineHeight: 1, color: ringColor }}
        >
          {labelText}
        </span>
      )}
    </motion.span>
  )
}
