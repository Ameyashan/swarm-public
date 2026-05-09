"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { Observation } from "./page"

type SortKey =
  | "portfolio_company_raw"
  | "industry"
  | "investment_type"
  | "interest_rate_text"
  | "fair_value"
  | "cost"
  | "accrual_status"

type SortDir = "asc" | "desc"

type AccrualFilter = "all" | "accrual" | "non_accrual"

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; align?: "right" }[] =
  [
    { key: "portfolio_company_raw", label: "Portfolio Company" },
    { key: "industry", label: "Industry" },
    { key: "investment_type", label: "Investment Type" },
    { key: "interest_rate_text", label: "Rate" },
    { key: "fair_value", label: "Fair Value", numeric: true, align: "right" },
    { key: "cost", label: "Cost", numeric: true, align: "right" },
    { key: "accrual_status", label: "Status" },
  ]

export function ObservationsTable({
  observations,
}: {
  observations: Observation[]
}) {
  const [sortKey, setSortKey] = useState<SortKey>("fair_value")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [accrualFilter, setAccrualFilter] = useState<AccrualFilter>("all")

  const filtered = useMemo(() => {
    if (accrualFilter === "all") return observations
    if (accrualFilter === "non_accrual") {
      return observations.filter((o) => o.accrual_status === "non_accrual")
    }
    // "accrual" = anything not explicitly non_accrual
    return observations.filter((o) => o.accrual_status !== "non_accrual")
  }, [observations, accrualFilter])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === "asc" ? 1 : -1
    arr.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]

      // nulls always sort last regardless of direction
      const aNull = av === null || av === undefined
      const bNull = bv === null || bv === undefined
      if (aNull && bNull) return 0
      if (aNull) return 1
      if (bNull) return -1

      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir
      }
      return String(av).localeCompare(String(bv)) * dir
    })
    return arr
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      // numeric columns default to descending (largest first); text to ascending
      const col = COLUMNS.find((c) => c.key === key)
      setSortDir(col?.numeric ? "desc" : "asc")
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">
          Schedule of Investments{" "}
          <span className="text-muted-foreground">
            ({sorted.length.toLocaleString()}
            {sorted.length !== observations.length
              ? ` of ${observations.length.toLocaleString()}`
              : ""}
            )
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Status:</label>
          <Select
            value={accrualFilter}
            onValueChange={(v) => setAccrualFilter(v as AccrualFilter)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All positions</SelectItem>
              <SelectItem value="accrual">Accrual only</SelectItem>
              <SelectItem value="non_accrual">Non-accrual only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    "select-none",
                    col.align === "right" && "text-right"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1 hover:text-foreground",
                      col.align === "right" && "ml-auto",
                      sortKey === col.key
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {col.label}
                    <SortIcon
                      active={sortKey === col.key}
                      dir={sortDir}
                    />
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMNS.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No observations match this filter.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="max-w-[260px] truncate font-medium">
                    {o.source_page_url ? (
                      <a
                        href={o.source_page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                        title={o.portfolio_company_raw ?? ""}
                      >
                        <span className="truncate">
                          {o.portfolio_company_raw ?? "—"}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                      </a>
                    ) : (
                      <span className="truncate" title={o.portfolio_company_raw ?? ""}>
                        {o.portfolio_company_raw ?? "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {o.industry ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {o.investment_type ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {o.interest_rate_text ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(o.fair_value)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(o.cost)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={o.accrual_status}
                      isPik={o.is_pik}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />
  return dir === "asc" ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  )
}

function StatusBadge({
  status,
  isPik,
}: {
  status: string | null
  isPik: boolean | null
}) {
  if (status === "non_accrual") {
    return (
      <div className="flex flex-wrap gap-1">
        <Badge variant="destructive">Non-accrual</Badge>
        {isPik ? <Badge variant="secondary">PIK</Badge> : null}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="outline">Accrual</Badge>
      {isPik ? <Badge variant="secondary">PIK</Badge> : null}
    </div>
  )
}

function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return "—"
  // values stored in $thousands; show with commas, no decimals
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
