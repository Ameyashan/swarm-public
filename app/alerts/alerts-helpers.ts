// Helpers for rendering detector hits on the /alerts page.
import { formatFV, formatPct } from "@/lib/format"

export type DetectorName =
  | "mark_drift_down"
  | "pik_creep"
  | "cross_fund_divergence"

export type DetectorHit = {
  id: string
  detector_name: DetectorName | string
  fund_ticker: string | null
  portfolio_company_canonical: string | null
  current_period_end: string | null
  prior_period_end: string | null
  severity_score: number | null
  hit_data: Record<string, any> | null
  cited_source_urls: string[] | null
  created_at: string
}

export const DETECTOR_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mark_drift_down", label: "Mark Drift Down" },
  { key: "pik_creep", label: "PIK Creep" },
  { key: "cross_fund_divergence", label: "Cross-Fund Divergence" },
]

export const DETECTOR_LABELS: Record<string, string> = {
  mark_drift_down: "Mark Drift Down",
  pik_creep: "PIK Creep",
  cross_fund_divergence: "Cross-Fund Divergence",
}

// Severity tiers per detector. Returns "severe" (red), "moderate" (yellow), or "mild" (default).
export function severityTier(
  detector: string,
  score: number | null,
): "severe" | "moderate" | "mild" {
  const s = Math.abs(score ?? 0)
  if (detector === "mark_drift_down") {
    if (s >= 0.2) return "severe"
    if (s >= 0.05) return "moderate"
  } else if (detector === "pik_creep") {
    if (s >= 0.05) return "severe"
    if (s >= 0.02) return "moderate"
  } else if (detector === "cross_fund_divergence") {
    if (s >= 0.3) return "severe"
    if (s >= 0.15) return "moderate"
  }
  return "mild"
}

// Tailwind classes for the detector badge based on severity tier.
export function severityBadgeClass(tier: "severe" | "moderate" | "mild"): string {
  switch (tier) {
    case "severe":
      return "bg-red-600 text-white hover:bg-red-600/90 border-transparent"
    case "moderate":
      return "bg-yellow-400 text-black hover:bg-yellow-400/90 border-transparent"
    default:
      return "bg-muted text-foreground border-transparent"
  }
}

export function summarize(hit: DetectorHit): string {
  const d = hit.hit_data ?? {}
  const ticker = hit.fund_ticker ?? undefined
  if (hit.detector_name === "mark_drift_down") {
    const change = Math.abs(Number(d.fv_change_pct ?? 0))
    const prior = formatFV(Number(d.fv_prior), ticker)
    const curr = formatFV(Number(d.fv_current), ticker)
    const accrual = d.accrual_status ? ` while still on ${d.accrual_status}` : ""
    return `Fair value down ${formatPct(change)} (${prior} → ${curr})${accrual}`
  }
  if (hit.detector_name === "pik_creep") {
    const delta = Number(d.delta_pp ?? 0)
    const prior = Number(d.pik_share_prior ?? 0)
    const curr = Number(d.pik_share_current ?? 0)
    return `PIK share rose ${(delta * 100).toFixed(2)}pp (${formatPct(prior, { digits: 2 })} → ${formatPct(curr, { digits: 2 })})`
  }
  if (hit.detector_name === "cross_fund_divergence") {
    const spread = Number(d.spread_pp ?? 0)
    const n = Number(d.n_funds ?? 0)
    return `Mark spread of ${(spread * 100).toFixed(1)}pp across ${n} funds`
  }
  return ""
}

// Returns the canonical source filing URL to link to from a hit card.
export function sourceFilingUrl(hit: DetectorHit): string | null {
  const d = hit.hit_data ?? {}
  if (typeof d.current_filing_url === "string" && d.current_filing_url) {
    return d.current_filing_url
  }
  if (Array.isArray(hit.cited_source_urls) && hit.cited_source_urls.length > 0) {
    return hit.cited_source_urls[0]
  }
  return null
}

// Returns fund tickers as a string. For cross_fund_divergence, hit_data.funds[] holds them.
export function fundTickerLabel(hit: DetectorHit): string {
  if (hit.fund_ticker) return hit.fund_ticker
  const funds = hit.hit_data?.funds
  if (Array.isArray(funds) && funds.length > 0) {
    return funds.map((f: any) => f.ticker).filter(Boolean).join(", ")
  }
  return "—"
}

export function companyLabel(hit: DetectorHit): string {
  if (hit.portfolio_company_canonical) return hit.portfolio_company_canonical
  // pik_creep hits are fund-level
  if (hit.detector_name === "pik_creep") return "(fund-level)"
  return "—"
}

// Format severity score for display (e.g. "23.4%" or "0.18pp")
export function formatSeverity(detector: string, score: number | null): string {
  if (score == null) return "—"
  const s = Math.abs(score)
  if (detector === "cross_fund_divergence" || detector === "mark_drift_down") {
    return formatPct(s)
  }
  if (detector === "pik_creep") {
    return `${(s * 100).toFixed(2)}pp`
  }
  return s.toFixed(3)
}
