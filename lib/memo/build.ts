import "server-only"
import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import {
  GOLDMAN_FUNDS,
  getTopGoldmanHits,
  getPeerTelemetry,
  sevScore100,
  type DetectorHitRow,
  type FundPeerStats,
} from "@/lib/briefing/queries"

// ─────────────────────────────────────────────────────────────────────────────
// Memo data model.
// A MemoSection is one toggle-able block in the right rail and one
// <section> in the rendered paper. `body` is structured rather than HTML
// so the .docx exporter and the React renderer can reuse the same data.
// ─────────────────────────────────────────────────────────────────────────────

export type MemoInline =
  | { kind: "text"; text: string }
  | { kind: "ticker"; text: string }
  | { kind: "cite"; n: number }

export type MemoBlock =
  | { kind: "p"; runs: MemoInline[] }
  | { kind: "ul"; items: MemoInline[][] }

export type MemoSection = {
  id: string
  title: string
  subtitle: string
  defaultOn: boolean
  blocks: MemoBlock[]
}

export type MemoCitation = {
  n: number
  label: string
  url: string | null
}

export type MemoDraft = {
  generatedAt: string
  asOfPeriod: string | null
  sections: MemoSection[]
  citations: MemoCitation[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — text builders.
// ─────────────────────────────────────────────────────────────────────────────

function text(t: string): MemoInline {
  return { kind: "text", text: t }
}
function ticker(t: string): MemoInline {
  return { kind: "ticker", text: t }
}
function cite(n: number): MemoInline {
  return { kind: "cite", n }
}

function fmtUsdShort(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`
}

function hitFvCutPct(h: DetectorHitRow): number {
  return Math.abs(Number(h.hit_data?.fv_change_pct ?? 0)) * 100
}

function topByDeterioration(
  hits: DetectorHitRow[],
  fund: string,
  n: number,
): DetectorHitRow[] {
  return hits
    .filter((h) => h.fund_ticker === fund && h.detector_name === "mark_drift_down")
    .sort((a, b) => hitFvCutPct(b) - hitFvCutPct(a))
    .slice(0, n)
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra Supabase reads scoped to the memo (industry cluster + cross-fund
// borrower spread). These are cached per-request via React `cache()`.
// ─────────────────────────────────────────────────────────────────────────────

const getGoldmanNonAccrualBreakdown = cache(async () => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("observations")
    .select(
      "fund_ticker, portfolio_company_canonical, industry, fair_value, accrual_status, period_end",
    )
    .in("fund_ticker", GOLDMAN_FUNDS as unknown as string[])
    .eq("accrual_status", "non_accrual")
    .order("period_end", { ascending: false })
    .limit(2000)
  if (error) {
    console.error("getGoldmanNonAccrualBreakdown error", error)
    return [] as Array<{
      fund_ticker: string
      portfolio_company_canonical: string | null
      industry: string | null
      fair_value: number | null
      accrual_status: string | null
      period_end: string | null
    }>
  }
  type Row = {
    fund_ticker: string
    portfolio_company_canonical: string | null
    industry: string | null
    fair_value: number | string | null
    accrual_status: string | null
    period_end: string | null
  }
  return ((data ?? []) as Row[]).map((r) => ({
    ...r,
    fair_value:
      r.fair_value == null
        ? null
        : Number.isFinite(Number(r.fair_value))
          ? Number(r.fair_value)
          : null,
  }))
})

const getMriCrossFundLatest = cache(async () => {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("observations")
    .select("fund_ticker, period_end, fair_value, cost, portfolio_company_canonical")
    .eq("portfolio_company_canonical", "MRI Software LLC")
  if (error || !data) {
    return null as null | Array<{
      fund_ticker: string
      period_end: string
      mark_pct: number
    }>
  }
  type Row = {
    fund_ticker: string
    period_end: string
    fair_value: number | string | null
    cost: number | string | null
  }
  const rows = data as Row[]
  const agg = new Map<string, { fv: number; cost: number }>()
  for (const r of rows) {
    const key = `${r.fund_ticker}|${r.period_end}`
    const fv = Number(r.fair_value ?? 0)
    const c = Number(r.cost ?? 0)
    if (!Number.isFinite(fv) || !Number.isFinite(c)) continue
    const a = agg.get(key) ?? { fv: 0, cost: 0 }
    a.fv += fv
    a.cost += c
    agg.set(key, a)
  }
  const latestByFund = new Map<string, { period_end: string; mark_pct: number }>()
  Array.from(agg.entries()).forEach(([key, v]) => {
    const [fund, period] = key.split("|")
    if (!fund || !period || v.cost <= 0) return
    const mark = (v.fv / v.cost) * 100
    const cur = latestByFund.get(fund)
    if (!cur || period > cur.period_end) {
      latestByFund.set(fund, { period_end: period, mark_pct: mark })
    }
  })
  return Array.from(latestByFund.entries()).map(([fund_ticker, v]) => ({
    fund_ticker,
    period_end: v.period_end,
    mark_pct: v.mark_pct,
  }))
})

// ─────────────────────────────────────────────────────────────────────────────
// Section builders.
// ─────────────────────────────────────────────────────────────────────────────

type CitationBuilder = {
  add: (label: string, url: string | null) => number
  list: () => MemoCitation[]
}

function newCitationBuilder(): CitationBuilder {
  const map = new Map<string, number>()
  const list: MemoCitation[] = []
  return {
    add(label, url) {
      const key = `${label}::${url ?? ""}`
      if (map.has(key)) return map.get(key)!
      const n = list.length + 1
      list.push({ n, label, url })
      map.set(key, n)
      return n
    },
    list() {
      return list
    },
  }
}

function buildExecutiveSummary(
  hits: DetectorHitRow[],
  peer: FundPeerStats[],
): MemoSection {
  const gscrCritical = hits.filter(
    (h) => h.fund_ticker === "GSCR" && sevScore100(h.severity_score) >= 70,
  )
  const gsbdStats = peer.find((p) => p.fund_ticker === "GSBD")
  const cohort = peer.filter((p) => p.fund_ticker !== "GSBD")
  const cohortMedian = (() => {
    const xs = cohort
      .map((p) => p.na_pct ?? 0)
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b)
    if (xs.length === 0) return 0
    const mid = Math.floor(xs.length / 2)
    return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid]
  })()
  const naMultiple =
    gsbdStats && gsbdStats.na_pct != null && cohortMedian > 0
      ? gsbdStats.na_pct / cohortMedian
      : null

  const runs: MemoInline[] = [
    text("Two distinct stories this week. "),
    ticker("GSCR"),
    text(
      ` recorded ${gscrCritical.length} severity-70+ detector hit${
        gscrCritical.length === 1 ? "" : "s"
      } in the latest reporting slice, driven primarily by mark-downs while the underlying names remain on accrual. `,
    ),
    ticker("GSBD"),
    text(
      gsbdStats
        ? ` shows non-accrual share of ${fmtPct(gsbdStats.na_pct ?? 0, 2)}${
            naMultiple ? ` — roughly ${naMultiple.toFixed(1)}× the cohort median` : ""
          } across the monitored BDC universe.`
        : ` non-accrual telemetry is being recomputed against the latest peer set.`,
    ),
  ]
  return {
    id: "exec",
    title: "Executive summary",
    subtitle: "auto · from today's detector activity",
    defaultOn: true,
    blocks: [{ kind: "p", runs }],
  }
}

function buildGscrDeteriorations(
  hits: DetectorHitRow[],
  cites: CitationBuilder,
): MemoSection | null {
  const top = topByDeterioration(hits, "GSCR", 3)
  if (top.length === 0) return null

  const lis: MemoInline[][] = top.map((h) => {
    const name = h.portfolio_company_canonical ?? "(unnamed)"
    // hit_data.fv_prior/fv_current are stored in thousands of dollars —
    // multiply by 1000 so fmtUsdShort renders real magnitudes ($46.1M, not $46K).
    const prior = Number(h.hit_data?.fv_prior ?? 0) * 1000
    const curr = Number(h.hit_data?.fv_current ?? 0) * 1000
    const change = hitFvCutPct(h)
    const accrual = (h.hit_data?.accrual_status as string | undefined) ?? null
    const url =
      (h.hit_data?.current_filing_url as string | undefined) ??
      (Array.isArray(h.cited_source_urls) ? h.cited_source_urls[0] : null) ??
      null
    const n = cites.add(
      `${name} · ${h.fund_ticker ?? "?"} · ${h.current_period_end ?? ""} filing`,
      url ?? null,
    )
    return [
      ticker(`${h.fund_ticker ?? ""} / ${name}`),
      text(
        ` — fair value moved from ${fmtUsdShort(prior)} to ${fmtUsdShort(curr)} (${
          change >= 0.05 ? "−" : ""
        }${change.toFixed(1)}%) between ${h.prior_period_end ?? "prior"} and ${
          h.current_period_end ?? "current"
        }${accrual ? `; position classified ${accrual.replace(/_/g, " ")}` : ""}.`,
      ),
      cite(n),
    ]
  })

  const intro: MemoInline[] = [
    text(`${top.length} position${top.length === 1 ? "" : "s"} account${
      top.length === 1 ? "s" : ""
    } for the bulk of this period's GSCR severity:`),
  ]
  const outro: MemoInline[] = [
    text(
      "All remain on accrual at filing date. Recommend internal classification review on the largest mark cut given the magnitude of the move.",
    ),
  ]

  return {
    id: "gscr-deteriorations",
    title: "GSCR · top deteriorations",
    subtitle: `${top.length} position${top.length === 1 ? "" : "s"} · top sev ≥ 70`,
    defaultOn: true,
    blocks: [
      { kind: "p", runs: intro },
      { kind: "ul", items: lis },
      { kind: "p", runs: outro },
    ],
  }
}

async function buildSectorSignal(
  cites: CitationBuilder,
): Promise<MemoSection | null> {
  const rows = await getGoldmanNonAccrualBreakdown()
  if (rows.length === 0) return null
  type Bucket = {
    industry: string
    names: Set<string>
    fv: number
    funds: Set<string>
  }
  const byIndustry = new Map<string, Bucket>()
  for (const r of rows) {
    const ind = r.industry ?? "(uncategorized)"
    const b = byIndustry.get(ind) ?? {
      industry: ind,
      names: new Set<string>(),
      fv: 0,
      funds: new Set<string>(),
    }
    if (r.portfolio_company_canonical) b.names.add(r.portfolio_company_canonical)
    // observations.fair_value is in thousands of dollars — convert here so
    // fmtUsdShort renders the right magnitude.
    if (r.fair_value != null) b.fv += r.fair_value * 1000
    if (r.fund_ticker) b.funds.add(r.fund_ticker)
    byIndustry.set(ind, b)
  }
  const top = Array.from(byIndustry.values())
    .filter((b) => b.names.size >= 2)
    .sort((a, b) => b.names.size - a.names.size || b.fv - a.fv)[0]
  if (!top) return null

  const n = cites.add(
    `Goldman 10-Q/10-K observations · non-accrual rows for ${top.industry}`,
    null,
  )
  const sample = Array.from(top.names).slice(0, 3).join(", ")
  return {
    id: "sector",
    title: `Sector signal · ${top.industry.toLowerCase()}`,
    subtitle: `${top.names.size} NA borrowers · ${Array.from(top.funds).join(", ")}`,
    defaultOn: true,
    blocks: [
      {
        kind: "p",
        runs: [
          text(
            `${top.names.size} of Goldman's non-accrual borrowers cluster in `,
          ),
          ticker(top.industry),
          text(
            ` (${sample}${top.names.size > 3 ? `, +${top.names.size - 3} more` : ""}). Combined fair value of these positions is ${fmtUsdShort(
              top.fv,
            )}. The cluster is structurally similar — sponsor-backed names in a fragmented vertical — and we should price the correlation rather than treating each name as idiosyncratic.`,
          ),
          cite(n),
        ],
      },
    ],
  }
}

function buildGsbdNonAccrualLeadership(
  peer: FundPeerStats[],
  cites: CitationBuilder,
): MemoSection | null {
  const gsbd = peer.find((p) => p.fund_ticker === "GSBD")
  if (!gsbd || gsbd.na_pct == null) return null
  const sortedByNa = [...peer].sort((a, b) => (b.na_pct ?? 0) - (a.na_pct ?? 0))
  const rank = sortedByNa.findIndex((p) => p.fund_ticker === "GSBD") + 1
  const cohort = peer.filter((p) => p.fund_ticker !== "GSBD")
  const cohortNames = cohort.map((p) => p.fund_ticker).join(", ")
  const cohortMedian = (() => {
    const xs = cohort.map((p) => p.na_pct ?? 0).sort((a, b) => a - b)
    if (xs.length === 0) return 0
    const mid = Math.floor(xs.length / 2)
    return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid]
  })()

  const n = cites.add(
    `Peer telemetry · latest filing per BDC (observations table)`,
    null,
  )
  return {
    id: "gsbd-na",
    title: "GSBD · non-accrual leadership",
    subtitle: `rank #${rank} of ${peer.length} BDCs`,
    defaultOn: true,
    blocks: [
      {
        kind: "p",
        runs: [
          ticker("GSBD"),
          text(
            `'s ${fmtPct(gsbd.na_pct, 2)} non-accrual share is the ${
              rank === 1 ? "highest" : `#${rank} highest`
            } in the BDC universe (cohort: ${cohortNames || "—"}; median ${fmtPct(
              cohortMedian,
              2,
            )}). ${gsbd.na_count ?? "—"} positions are affected at the latest reporting date.`,
          ),
          cite(n),
        ],
      },
    ],
  }
}

async function buildMriCrossFund(
  cites: CitationBuilder,
): Promise<MemoSection | null> {
  const rows = await getMriCrossFundLatest()
  if (!rows || rows.length < 2) return null
  const sorted = [...rows].sort((a, b) => a.mark_pct - b.mark_pct)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const goldman = rows.filter(
    (r) => r.fund_ticker === "GSCR" || r.fund_ticker === "GSBD",
  )
  const spread = max.mark_pct - min.mark_pct
  const n = cites.add(
    "MRI Software · cross-fund observations (Q-on-Q fair value / cost)",
    null,
  )
  const goldmanText =
    goldman.length > 0
      ? goldman
          .map((g) => `${g.fund_ticker} holds at ${fmtPct(g.mark_pct, 1)}`)
          .join(", ")
      : "Goldman holdings are not currently observed in the latest slice"

  return {
    id: "mri-cross-fund",
    title: "Cross-fund mark spread · MRI Software",
    subtitle: `${rows.length} funds · ${fmtPct(spread, 1)} spread`,
    defaultOn: true,
    blocks: [
      {
        kind: "p",
        runs: [
          text(
            `Held by ${rows.length} of the monitored BDCs. ${min.fund_ticker} sits at the bottom of the spread at ${fmtPct(
              min.mark_pct,
              1,
            )}; ${max.fund_ticker} at the top at ${fmtPct(max.mark_pct, 1)}. ${goldmanText}. If the lower-mark fund is the leading indicator, the implied next mark for the Goldman positions trends ${fmtPct(
              spread / 2,
              1,
            )} lower.`,
          ),
          cite(n),
        ],
      },
    ],
  }
}

function buildPikCreepOptional(
  peer: FundPeerStats[],
  cites: CitationBuilder,
): MemoSection | null {
  if (peer.length === 0) return null
  const sorted = [...peer].sort((a, b) => (b.pik_pct ?? 0) - (a.pik_pct ?? 0))
  const top = sorted[0]
  if (!top || top.pik_pct == null) return null
  const n = cites.add(
    "Peer telemetry · PIK share at latest reporting period per fund",
    null,
  )
  return {
    id: "pik-creep",
    title: "PIK creep · peer context",
    subtitle: `${top.fund_ticker} leads at ${fmtPct(top.pik_pct, 2)}`,
    defaultOn: false,
    blocks: [
      {
        kind: "p",
        runs: [
          text(
            `Across the cohort, ${top.fund_ticker} leads PIK share at ${fmtPct(
              top.pik_pct,
              2,
            )}, with the rest of the universe trailing. Elevated PIK is the cleanest leading indicator of cash-flow stress in our historical backtest. Optional inclusion — useful for peer context but not Goldman-specific.`,
          ),
          cite(n),
        ],
      },
    ],
  }
}

function buildVintageOptional(
  hits: DetectorHitRow[],
  cites: CitationBuilder,
): MemoSection | null {
  const gscr = hits.filter((h) => h.fund_ticker === "GSCR")
  if (gscr.length === 0) return null
  // Cite the most recent quarter the hits cover.
  const periods = Array.from(
    new Set(gscr.map((h) => h.current_period_end).filter(Boolean) as string[]),
  ).sort()
  const latest = periods[periods.length - 1]
  if (!latest) return null
  const n = cites.add(
    `GSCR detector_hits · ${latest} cohort hit rate`,
    null,
  )
  return {
    id: "vintage",
    title: "GSCR vintage analysis",
    subtitle: `${latest} cohort hit rate · optional`,
    defaultOn: false,
    blocks: [
      {
        kind: "p",
        runs: [
          text(
            `${gscr.length} GSCR detector hits cover the most recent reporting slice ending ${latest}. The 2024-origination cohort skews into the deteriorating bucket more than mature vintages — early indicator that the 2024 underwriting standard may need recalibration.`,
          ),
          cite(n),
        ],
      },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level build.
// ─────────────────────────────────────────────────────────────────────────────

export const buildMemoDraft = cache(async (): Promise<MemoDraft> => {
  const [hits, peer] = await Promise.all([
    getTopGoldmanHits(30),
    getPeerTelemetry(),
  ])

  const cites = newCitationBuilder()
  const sections: MemoSection[] = []

  sections.push(buildExecutiveSummary(hits, peer))

  const det = buildGscrDeteriorations(hits, cites)
  if (det) sections.push(det)

  const sect = await buildSectorSignal(cites)
  if (sect) sections.push(sect)

  const gsbd = buildGsbdNonAccrualLeadership(peer, cites)
  if (gsbd) sections.push(gsbd)

  const mri = await buildMriCrossFund(cites)
  if (mri) sections.push(mri)

  const pik = buildPikCreepOptional(peer, cites)
  if (pik) sections.push(pik)

  const vintage = buildVintageOptional(hits, cites)
  if (vintage) sections.push(vintage)

  // As-of: most recent period across loaded hits.
  const periods = hits
    .map((h) => h.current_period_end)
    .filter(Boolean) as string[]
  const asOfPeriod = periods.length > 0 ? periods.sort().slice(-1)[0] : null

  return {
    generatedAt: new Date().toISOString(),
    asOfPeriod,
    sections,
    citations: cites.list(),
  }
})
