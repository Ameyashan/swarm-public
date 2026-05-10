"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState, useTransition } from "react"

const FV_OPTIONS = [
  { label: "$1M+", value: "1000" },
  { label: "$5M+", value: "5000" },
  { label: "$10M+", value: "10000" },
  { label: "$25M+", value: "25000" },
  { label: "$50M+", value: "50000" },
]

const ACCRUAL_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Accrual only", value: "accrual" },
  { label: "Non-accrual only", value: "non_accrual" },
]

type Props = {
  /** Funds eligible for the multi-select. */
  fundOptions: string[]
  /** Initial values from URL search params. */
  initial: {
    minFv: string
    accrual: string
    funds: string[]
  }
}

/**
 * Drift screener filter bar. Updates URL query params (which the server
 * component reads) — preserves `sort` and `dir` if already set.
 */
export function DriftFilters({ fundOptions, initial }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [minFv, setMinFv] = useState(initial.minFv)
  const [accrual, setAccrual] = useState(initial.accrual)
  const [selectedFunds, setSelectedFunds] = useState<string[]>(initial.funds)

  function applyFilters(next: {
    minFv?: string
    accrual?: string
    funds?: string[]
  }) {
    const usp = new URLSearchParams(params?.toString() ?? "")
    const mf = next.minFv ?? minFv
    const ac = next.accrual ?? accrual
    const fs = next.funds ?? selectedFunds

    if (mf && mf !== "1000") usp.set("min_fv", mf)
    else usp.delete("min_fv")

    if (ac && ac !== "all") usp.set("accrual", ac)
    else usp.delete("accrual")

    if (fs.length > 0) usp.set("funds", fs.join(","))
    else usp.delete("funds")

    // Reset pagination when filters change.
    usp.delete("page")

    const qs = usp.toString()
    startTransition(() => {
      router.push(qs ? `/drift?${qs}` : "/drift")
    })
  }

  function toggleFund(t: string) {
    const next = selectedFunds.includes(t)
      ? selectedFunds.filter((f) => f !== t)
      : [...selectedFunds, t]
    setSelectedFunds(next)
    applyFilters({ funds: next })
  }

  const clearAll = useMemo(() => {
    return (
      minFv !== "1000" ||
      accrual !== "all" ||
      selectedFunds.length > 0
    )
  }, [minFv, accrual, selectedFunds])

  return (
    <div className="rounded-xl border border-default bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <FilterGroup label="Minimum FV">
          <div className="flex flex-wrap gap-1">
            {FV_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setMinFv(opt.value)
                  applyFilters({ minFv: opt.value })
                }}
                className={pillClass(opt.value === minFv)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FilterGroup>

        <FilterGroup label="Accrual status">
          <div className="flex flex-wrap gap-1">
            {ACCRUAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setAccrual(opt.value)
                  applyFilters({ accrual: opt.value })
                }}
                className={pillClass(opt.value === accrual)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FilterGroup>

        <FilterGroup label="Funds">
          <div className="flex flex-wrap gap-1">
            {fundOptions.map((t) => {
              const active = selectedFunds.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleFund(t)}
                  className={pillClass(active)}
                >
                  {t}
                </button>
              )
            })}
          </div>
        </FilterGroup>

        {clearAll && (
          <button
            type="button"
            onClick={() => {
              setMinFv("1000")
              setAccrual("all")
              setSelectedFunds([])
              applyFilters({
                minFv: "1000",
                accrual: "all",
                funds: [],
              })
            }}
            className="ml-auto rounded-md border border-default px-3 py-1.5 text-xs text-muted transition-colors hover:border-hover hover:text-default"
          >
            Clear all
          </button>
        )}
      </div>
      {isPending && (
        <div className="mt-2 text-[11px] font-mono uppercase tracking-wider text-dim">
          Updating…
        </div>
      )}
    </div>
  )
}

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-mono uppercase tracking-wider text-dim">
        {label}
      </span>
      {children}
    </div>
  )
}

function pillClass(active: boolean): string {
  return (
    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
    (active
      ? "border-accent bg-accent/10 text-accent"
      : "border-default bg-elevated text-muted hover:border-hover hover:text-default")
  )
}
