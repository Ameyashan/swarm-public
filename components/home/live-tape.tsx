"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { encodeCanonicalSlug } from "@/lib/slug"

export type TapeItem = {
  id: string
  fund: string
  company: string
  /** mark_drift change as a fraction (e.g. -0.235 = down 23.5%) */
  changePct: number
  /** "critical" | "high" | "medium" | "low" */
  tier: "critical" | "high" | "medium" | "low"
  /** Optional canonical name used for /watch links. Falls back to `company`. */
  canonical?: string
}

const TIER_COLOR: Record<TapeItem["tier"], string> = {
  critical: "#EF4444",
  high: "#F59E0B",
  medium: "#FBBF24",
  low: "#9CA3AF",
}

function Pill({ item }: { item: TapeItem }) {
  const color = TIER_COLOR[item.tier]
  const slug = encodeCanonicalSlug(item.canonical ?? item.company)
  const pct = (Math.abs(item.changePct) * 100).toFixed(1)

  return (
    <Link
      href={`/watch/${slug}`}
      className="group inline-flex shrink-0 items-center gap-2 px-5 text-sm font-mono"
      title={`${item.fund} · ${item.company} · -${pct}%`}
    >
      <span className="font-semibold text-default">{item.fund}</span>
      <span className="text-dim">·</span>
      <span
        className="font-semibold"
        style={{ color }}
      >
        ▼
      </span>
      <span className="max-w-[18ch] truncate text-default group-hover:underline">
        {item.company}
      </span>
      <span
        className="font-semibold tabular-nums"
        style={{ color }}
      >
        -{pct}%
      </span>
      <span className="ml-1 text-dim">•</span>
    </Link>
  )
}

/**
 * Horizontally-scrolling live tape of the most recent detector hits.
 * Animates left at 30s per cycle, infinite. Two copies are concatenated so the
 * loop is visually seamless.
 */
export function LiveTape({ items }: { items: TapeItem[] }) {
  if (items.length === 0) return null
  const doubled = [...items, ...items]

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-default bg-card py-3">
      {/* edge fades */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16"
        style={{
          background:
            "linear-gradient(to right, #0F1623 0%, rgba(15,22,35,0) 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16"
        style={{
          background:
            "linear-gradient(to left, #0F1623 0%, rgba(15,22,35,0) 100%)",
        }}
      />

      <motion.div
        className="flex w-max items-center"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, ease: "linear", repeat: Infinity }}
      >
        {doubled.map((item, idx) => (
          <Pill key={`${item.id}-${idx}`} item={item} />
        ))}
      </motion.div>
    </div>
  )
}
