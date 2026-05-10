/**
 * Centralized formatting utilities for Swarm Public.
 *
 * IMPORTANT — fair_value scale convention.
 * ----------------------------------------
 * Different BDC issuers report Schedule of Investments amounts at different
 * scales. ARCC reports in $millions; every other fund we ingest reports in
 * $thousands. We normalize to canonical *whole dollars* at the formatter
 * boundary using the fund ticker.
 *
 * All UI code MUST go through these helpers — no ad-hoc number formatting in
 * components. If you need a new format, add it here.
 */

// Funds whose fair_value, cost, principal_amount are stored in $millions.
// Everything else is treated as $thousands.
const FUND_MILLIONS = new Set<string>(["ARCC"])

/**
 * Convert a raw fair-value-like number from a row into whole dollars,
 * accounting for per-fund storage scale.
 *
 * @param raw Raw value as stored in `observations.fair_value` /
 *            `observations.cost` / `observations.principal_amount` /
 *            `detector_hits.hit_data.fv_*`.
 * @param fundTicker Optional fund ticker. When omitted we assume $thousands.
 */
export function toDollars(
  raw: number | string | null | undefined,
  fundTicker?: string | null,
): number | null {
  if (raw === null || raw === undefined) return null
  const n = typeof raw === "string" ? Number(raw) : raw
  if (!Number.isFinite(n)) return null
  const ticker = (fundTicker ?? "").toUpperCase()
  const factor = FUND_MILLIONS.has(ticker) ? 1_000_000 : 1_000
  return n * factor
}

/**
 * Format a fair-value-like number as a compact USD string.
 *
 * Two modes:
 *  - Pass `fundTicker` to normalize from raw row scale ($thousands or
 *    $millions) to display.
 *  - Omit `fundTicker` to format a value already expressed in whole dollars.
 *
 * Renders as $X.XB / $X.XM / $X.XK. Returns "—" for null/NaN.
 *
 * @example
 *   formatFV(29703.3, "ARCC")    // "$29.7B"  (raw, ARCC = millions)
 *   formatFV(7104461, "GBDC")    // "$7.1B"   (raw, GBDC = thousands)
 *   formatFV(92_641_714_000)     // "$92.6B"  (already whole dollars)
 *   formatFV(null)               // "—"
 */
export function formatFV(
  raw: number | string | null | undefined,
  fundTicker?: string | null,
): string {
  if (raw === null || raw === undefined) return "—"
  const dollars =
    fundTicker !== undefined && fundTicker !== null
      ? toDollars(raw, fundTicker)
      : typeof raw === "string"
        ? Number(raw)
        : raw
  if (dollars == null || !Number.isFinite(dollars)) return "—"
  const abs = Math.abs(dollars)
  if (abs >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
  return `$${dollars.toFixed(0)}`
}

/**
 * Alias for `formatFV` without fund-ticker context. Use this when the value
 * is already expressed in whole dollars.
 */
export function formatUSD(dollars: number | null | undefined): string {
  return formatFV(dollars)
}

/**
 * Format a fraction (0.0–1.0) as a percentage string with sign and digit
 * control. Returns "—" for null/NaN.
 *
 * @param n Fraction.
 * @param opts Optional control. `digits` defaults to 1. `signed` adds a
 *             leading "+" for positive values.
 *
 * @example
 *   formatPct(0.123)              // "12.3%"
 *   formatPct(-0.42, {digits: 0}) // "-42%"
 *   formatPct(0.05, {signed: true}) // "+5.0%"
 */
export function formatPct(
  n: number | string | null | undefined,
  opts: { digits?: number; signed?: boolean } = {},
): string {
  if (n === null || n === undefined) return "—"
  const v = typeof n === "string" ? Number(n) : n
  if (!Number.isFinite(v)) return "—"
  const digits = opts.digits ?? 1
  const sign = opts.signed && v > 0 ? "+" : ""
  return `${sign}${(v * 100).toFixed(digits)}%`
}

/**
 * Format a percentage-point delta (already in pp scale, e.g. 1.5 means
 * 1.5pp).
 *
 * @example
 *   formatPP(1.5)            // "+1.5pp"
 *   formatPP(-0.4, {signed: false}) // "-0.4pp"
 */
export function formatPP(
  n: number | null | undefined,
  opts: { digits?: number; signed?: boolean } = {},
): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const digits = opts.digits ?? 1
  const signed = opts.signed ?? true
  const sign = signed && n > 0 ? "+" : ""
  return `${sign}${n.toFixed(digits)}pp`
}

/**
 * Format an ISO date or YYYY-MM-DD as "MMM YYYY" (e.g. "Mar 2026"). Falls
 * back to the raw string on parse failure.
 */
export function formatDate(s: string | Date | null | undefined): string {
  if (!s) return "—"
  const d = s instanceof Date ? s : new Date(typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)
  if (Number.isNaN(d.getTime())) return String(s)
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ]
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * Compact quarter label: "Q1 '26".
 */
export function formatQuarter(s: string | null | undefined): string {
  if (!s) return "—"
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)
  if (Number.isNaN(d.getTime())) return s
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `Q${q} '${String(d.getUTCFullYear()).slice(-2)}`
}

/**
 * Plain integer with thousands separators.
 */
export function formatInt(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—"
  const v = typeof n === "string" ? Number(n) : n
  if (!Number.isFinite(v)) return "—"
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 })
}
