"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import CountUp from "react-countup"
import { encodeCanonicalSlug } from "@/lib/slug"

export type TopBorrower = {
  canonical: string
  fund_count: number
  funds: string[]
  /** total fair value across all funds, in $ millions */
  total_fv_m: number
}

function formatFv(millions: number): {
  value: number
  decimals: number
  prefix: string
  suffix: string
} {
  if (millions >= 1000) {
    return { value: millions / 1000, decimals: 2, prefix: "$", suffix: "B" }
  }
  return { value: millions, decimals: 1, prefix: "$", suffix: "M" }
}

function BorrowerCard({ b, index }: { b: TopBorrower; index: number }) {
  const fv = formatFv(b.total_fv_m)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{
        duration: 0.5,
        delay: index * 0.05,
        ease: [0.32, 0.72, 0, 1],
      }}
      whileHover={{ y: -4 }}
      className="group"
    >
      <Link
        href={`/watch/${encodeCanonicalSlug(b.canonical)}`}
        className="block h-full rounded-xl border border-default bg-card p-5 transition-colors hover:border-hover"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold leading-snug text-default group-hover:text-accent">
            {b.canonical}
          </h3>
          <span className="shrink-0 rounded-md border border-default bg-elevated px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-muted">
            {b.fund_count} funds
          </span>
        </div>

        <div className="mt-4 flex items-baseline gap-1">
          <span className="text-xl text-muted">{fv.prefix}</span>
          <span className="text-3xl font-semibold tabular-nums text-default">
            <CountUp
              end={fv.value}
              duration={1.5}
              decimals={fv.decimals}
              separator=","
              enableScrollSpy
              scrollSpyOnce
            />
          </span>
          <span className="text-xl text-muted">{fv.suffix}</span>
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-wider text-dim">
          Total fair value
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {b.funds.map((f) => (
            <span
              key={f}
              className="rounded-md border border-default bg-elevated px-2 py-0.5 font-mono text-[11px] tracking-wide text-muted"
            >
              {f}
            </span>
          ))}
        </div>
      </Link>
    </motion.div>
  )
}

export function TopBorrowers({ borrowers }: { borrowers: TopBorrower[] }) {
  if (borrowers.length === 0) {
    return (
      <p className="text-sm text-muted">
        No cross-fund borrowers detected yet.
      </p>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {borrowers.map((b, i) => (
        <BorrowerCard key={b.canonical} b={b} index={i} />
      ))}
    </div>
  )
}
