import Link from "next/link"
import { format } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { encodeCanonicalSlug } from "@/lib/slug"
import { Sparkline } from "@/components/charts/Sparkline"
import { AnimatedNumber } from "@/components/charts/AnimatedNumber"
import { DriftFilters } from "@/components/drift/drift-filters"
import { DriftToast } from "./drift-toast"
import {
  DETECTOR_LABELS,
  formatSeverity,
} from "@/app/alerts/alerts-helpers"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50
const SPARK_QUARTERS = 8
const FUND_OPTIONS = ["ARCC", "OBDC", "GBDC", "GSBD", "GSCR", "MAIN"]

type SearchParams = {
  min_fv?: string
  accrual?: string
  funds?: string
  sort?: string
  dir?: string
  page?: string
}

type DriftRow = {
  fund_ticker: string
  portfolio_company_canonical: string
  latest_period_end: string
  latest_fv: number | string
  latest_cost: number | string | null
  latest_accrual_status: string | null
  latest_is_pik: boolean | null
  prior_period_end: string | null
  prior_fv: number | string | null
  fv_change_pct: number | string | null
  fv_change_thousands: number | string | null
  latest_hit_id: string | null
  latest_detector: string | null
  latest_severity: number | string | null
  total_count: number | string
}

type StatsRow = {
  total_positions: number | string
  count_drop_10: number | string
  count_drop_25: number | string
  total_at_risk_thousands: number | string
}

const SORT_KEYS = ["change_pct", "change_dollar", "latest_fv", "borrower"] as const
type SortKey = (typeof SORT_KEYS)[number]

const SORT_LABELS: Record<SortKey, string> = {
  change_pct: "Change %",
  change_dollar: "Change $",
  latest_fv: "Latest FV",
  borrower: "Borrower",
}

function fmtUsdK(thousands: number | null | undefined): string {
  if (thousands == null || !Number.isFinite(Number(thousands))) return "—"
  const t = Number(thousands)
  const abs = Math.abs(t)
  if (abs >= 1_000_000) return `$${(t / 1_000_000).toFixed(2)}B`
  if (abs >= 1_000) return `$${(t / 1_000).toFixed(1)}M`
  return `$${t.toFixed(0)}K`
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(Number(p))) return "—"
  const v = Number(p) * 100
  const sign = v > 0 ? "+" : ""
  return `${sign}${v.toFixed(1)}%`
}

function changeColor(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "text-muted"
  if (pct <= -0.25) return "text-severity-critical"
  if (pct <= -0.1) return "text-severity-high"
  if (pct < 0) return "text-severity-medium"
  if (pct > 0.05) return "text-status-accrual"
  return "text-default"
}

export default async function DriftPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  // ── Parse params ───────────────────────────────────────────────
  const minFvStr = searchParams.min_fv ?? "1000"
  const minFv = Math.max(0, Number(minFvStr) || 1000)

  const accrual =
    searchParams.accrual === "accrual" ||
    searchParams.accrual === "non_accrual"
      ? searchParams.accrual
      : "all"

  const fundsParam = (searchParams.funds ?? "").trim()
  const fundFilter = fundsParam
    ? fundsParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => FUND_OPTIONS.includes(s))
    : []

  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(
    searchParams.sort ?? "",
  )
    ? (searchParams.sort as SortKey)
    : "change_pct"
  const sortDir = searchParams.dir === "desc" ? "desc" : "asc"
  const pageNum = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1)

  // ── Fetch ──────────────────────────────────────────────────────
  const supabase = createClient()
  const fundArg = fundFilter.length > 0 ? fundFilter : null

  const [statsRes, queryRes] = await Promise.all([
    supabase.rpc("drift_screener_stats", {
      min_fv_thousands: minFv,
      accrual_filter: accrual,
      fund_tickers: fundArg,
    }),
    supabase.rpc("drift_screener_query", {
      min_fv_thousands: minFv,
      accrual_filter: accrual,
      fund_tickers: fundArg,
      sort_key: sortKey,
      sort_dir: sortDir,
      page_size: PAGE_SIZE,
      page_num: pageNum,
    }),
  ])

  const rows = (queryRes.data ?? []) as DriftRow[]
  const stats = ((statsRes.data ?? [])[0] ?? {
    total_positions: 0,
    count_drop_10: 0,
    count_drop_25: 0,
    total_at_risk_thousands: 0,
  }) as StatsRow

  const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  // ── Sparkline data ─────────────────────────────────────────────
  const borrowerNames = Array.from(
    new Set(rows.map((r) => r.portfolio_company_canonical)),
  )
  const sparkByBorrower = new Map<string, { x: string; y: number }[]>()
  if (borrowerNames.length > 0) {
    const { data: sparkData } = await supabase.rpc("borrower_fv_series", {
      borrowers: borrowerNames,
      quarters: SPARK_QUARTERS,
    })
    for (const r of (sparkData ?? []) as Array<{
      portfolio_company_canonical: string
      period_end: string
      fv_thousands: number | string
    }>) {
      const arr =
        sparkByBorrower.get(r.portfolio_company_canonical) ?? []
      arr.push({ x: r.period_end, y: Number(r.fv_thousands) })
      sparkByBorrower.set(r.portfolio_company_canonical, arr)
    }
  }

  // ── URL helpers ────────────────────────────────────────────────
  function buildHref(overrides: Partial<SearchParams>): string {
    const usp = new URLSearchParams()
    const next = { ...searchParams, ...overrides }
    if (next.min_fv && next.min_fv !== "1000") usp.set("min_fv", next.min_fv)
    if (next.accrual && next.accrual !== "all") usp.set("accrual", next.accrual)
    if (next.funds) usp.set("funds", next.funds)
    if (next.sort && next.sort !== "change_pct") usp.set("sort", next.sort)
    if (next.dir && next.dir !== "asc") usp.set("dir", next.dir)
    if (next.page && next.page !== "1") usp.set("page", next.page)
    const qs = usp.toString()
    return qs ? `/drift?${qs}` : "/drift"
  }

  function sortHref(key: SortKey): string {
    // Toggle dir when clicking the same column.
    let nextDir: "asc" | "desc"
    if (sortKey === key) {
      nextDir = sortDir === "asc" ? "desc" : "asc"
    } else {
      // Default: ascending for change_pct (worst first), descending for others.
      nextDir = key === "change_pct" || key === "borrower" ? "asc" : "desc"
    }
    return buildHref({
      sort: key,
      dir: nextDir,
      page: "1",
    })
  }

  const driftSignature = JSON.stringify({
    minFv: minFvStr,
    accrual,
    funds: fundFilter,
    sort: sortKey,
    dir: sortDir,
  })

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-12 sm:py-16">
      <DriftToast count={totalCount} signature={driftSignature} />
      <header className="mb-8">
        <div className="mb-2 text-sm">
          <Link
            href="/"
            className="text-muted underline-offset-4 hover:text-default hover:underline"
          >
            ← Home
          </Link>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-default sm:text-5xl">
          Drift screener
        </h1>
        <p className="mt-2 max-w-3xl text-muted">
          Borrower-level credit deterioration ranked by quarter-over-quarter
          fair value change. Worst movers first. Tranches within each filing are
          aggregated into a single position per borrower-fund-quarter before
          ranking.
        </p>
      </header>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total positions"
          value={Number(stats.total_positions)}
        />
        <StatCard
          label=">10% drop"
          value={Number(stats.count_drop_10)}
          accentClass="text-severity-high"
        />
        <StatCard
          label=">25% drop"
          value={Number(stats.count_drop_25)}
          accentClass="text-severity-critical"
        />
        <StatCard
          label="$ at risk (>10% drop)"
          value={Number(stats.total_at_risk_thousands) / 1_000}
          prefix="$"
          suffix="M"
          decimals={1}
        />
      </div>

      {/* Filters */}
      <div className="mb-6">
        <DriftFilters
          fundOptions={FUND_OPTIONS}
          initial={{
            minFv: minFvStr,
            accrual,
            funds: fundFilter,
          }}
        />
      </div>

      {/* Results header */}
      <div className="mb-3 flex items-baseline justify-between text-sm">
        <span className="text-muted">
          {totalCount.toLocaleString("en-US")} matching positions · sorted by{" "}
          <span className="font-medium text-default">
            {SORT_LABELS[sortKey]}
          </span>{" "}
          ({sortDir})
        </span>
        <span className="text-[11px] font-mono uppercase tracking-wider text-dim">
          Page {pageNum} of {totalPages}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-default bg-card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-default text-left text-[11px] font-mono uppercase tracking-wider text-dim">
              <SortableTh
                label="Borrower"
                active={sortKey === "borrower"}
                dir={sortDir}
                href={sortHref("borrower")}
              />
              <th className="px-3 py-2">Fund</th>
              <SortableTh
                label="Latest FV"
                active={sortKey === "latest_fv"}
                dir={sortDir}
                href={sortHref("latest_fv")}
                align="right"
              />
              <th className="px-3 py-2 text-right">Prior FV</th>
              <SortableTh
                label="Δ %"
                active={sortKey === "change_pct"}
                dir={sortDir}
                href={sortHref("change_pct")}
                align="right"
              />
              <SortableTh
                label="Δ $"
                active={sortKey === "change_dollar"}
                dir={sortDir}
                href={sortHref("change_dollar")}
                align="right"
              />
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">FV · 8q</th>
              <th className="px-3 py-2">Latest hit</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-12 text-center text-sm text-muted"
                >
                  No positions match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const slug = encodeCanonicalSlug(r.portfolio_company_canonical)
                const changePct =
                  r.fv_change_pct == null ? null : Number(r.fv_change_pct)
                const series =
                  sparkByBorrower.get(r.portfolio_company_canonical) ?? []
                const accrualLabel = formatAccrual(r.latest_accrual_status)
                const accrualClass = accrualClassFor(r.latest_accrual_status)
                const hitLabel = r.latest_detector
                  ? DETECTOR_LABELS[r.latest_detector] ?? r.latest_detector
                  : null
                const hitSeverityLabel =
                  r.latest_detector && r.latest_severity != null
                    ? formatSeverity(
                        r.latest_detector,
                        Number(r.latest_severity),
                      )
                    : null

                return (
                  <tr
                    key={`${r.fund_ticker}|${r.portfolio_company_canonical}|${r.latest_period_end}`}
                    className="border-b border-default/60 transition-colors hover:bg-elevated"
                  >
                    <td className="px-3 py-2.5 align-middle">
                      <Link
                        href={`/watch/${slug}`}
                        className="font-medium text-default underline-offset-4 hover:text-accent hover:underline"
                      >
                        {r.portfolio_company_canonical}
                      </Link>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-dim">
                        {r.latest_period_end
                          ? format(
                              new Date(r.latest_period_end),
                              "MMM yyyy",
                            )
                          : "—"}
                        {r.latest_is_pik ? " · PIK" : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <Link
                        href={`/funds/${r.fund_ticker}`}
                        className="font-mono text-xs text-default hover:text-accent"
                      >
                        {r.fund_ticker}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-default">
                      {fmtUsdK(Number(r.latest_fv))}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">
                      {fmtUsdK(
                        r.prior_fv == null ? null : Number(r.prior_fv),
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right font-mono font-semibold tabular-nums",
                        changeColor(changePct),
                      )}
                    >
                      {fmtPct(changePct)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right font-mono tabular-nums",
                        changeColor(changePct),
                      )}
                    >
                      {fmtUsdK(
                        r.fv_change_thousands == null
                          ? null
                          : Number(r.fv_change_thousands),
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className={cn("text-xs font-medium", accrualClass)}>
                        {accrualLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <Sparkline
                        data={series}
                        width={120}
                        height={32}
                        color={
                          changePct != null && changePct < -0.1
                            ? "#EF4444"
                            : "#3B82F6"
                        }
                        animate={false}
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      {r.latest_hit_id && hitLabel ? (
                        <Link
                          href={`/alerts/${r.latest_hit_id}`}
                          className="block max-w-[180px] truncate text-xs text-default hover:text-accent"
                        >
                          <span className="block truncate">{hitLabel}</span>
                          {hitSeverityLabel && (
                            <span className="block text-[10px] font-mono text-dim">
                              {hitSeverityLabel}
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span className="text-xs text-dim">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between text-sm">
          <span className="text-muted">
            Showing {(pageNum - 1) * PAGE_SIZE + 1}–
            {Math.min(pageNum * PAGE_SIZE, totalCount)} of{" "}
            {totalCount.toLocaleString("en-US")}
          </span>
          <div className="flex gap-2">
            {pageNum > 1 ? (
              <Link
                href={buildHref({ page: String(pageNum - 1) })}
                className="rounded-md border border-default px-3 py-1.5 text-default hover:border-hover"
              >
                ← Previous
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-default px-3 py-1.5 text-dim opacity-50">
                ← Previous
              </span>
            )}
            {pageNum < totalPages ? (
              <Link
                href={buildHref({ page: String(pageNum + 1) })}
                className="rounded-md border border-default px-3 py-1.5 text-default hover:border-hover"
              >
                Next →
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-default px-3 py-1.5 text-dim opacity-50">
                Next →
              </span>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

function StatCard({
  label,
  value,
  prefix,
  suffix,
  decimals = 0,
  accentClass,
}: {
  label: string
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  accentClass?: string
}) {
  return (
    <div className="rounded-lg border border-default bg-card p-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-dim">
        {label}
      </div>
      <AnimatedNumber
        value={value}
        prefix={prefix}
        suffix={suffix}
        decimals={decimals}
        numberClassName={cn(
          "mt-1 text-3xl font-semibold tabular-nums",
          accentClass ?? "text-default",
        )}
      />
    </div>
  )
}

function SortableTh({
  label,
  active,
  dir,
  href,
  align = "left",
}: {
  label: string
  active: boolean
  dir: string
  href: string
  align?: "left" | "right"
}) {
  const arrow = active ? (dir === "asc" ? "↑" : "↓") : ""
  return (
    <th
      className={cn(
        "px-3 py-2",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <Link
        href={href}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-default",
          active ? "text-default" : "text-dim",
        )}
      >
        {label}
        {arrow && (
          <span className="text-[10px] text-accent">{arrow}</span>
        )}
      </Link>
    </th>
  )
}

function formatAccrual(status: string | null | undefined): string {
  if (!status) return "—"
  const s = status.toLowerCase()
  if (s.includes("non")) return "Non-accrual"
  if (s === "pik" || s === "partial_pik") return "PIK"
  return "Accrual"
}

function accrualClassFor(status: string | null | undefined): string {
  if (!status) return "text-dim"
  const s = status.toLowerCase()
  if (s.includes("non")) return "text-status-non-accrual"
  return "text-status-accrual"
}
