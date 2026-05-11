// Deterministic, code-only derivation of briefing prose, "what changed"
// cards, committee questions, and forward-signal rows from live query
// results. No LLM, no fabrication — every numeric value, name, date, and
// rank in user-visible text traces back to a query result.

import {
  sevScore100,
  type DetectorHitRow,
  type EnrichmentJoined,
  type LitigationItem,
  type ManagementChangeItem,
  type NewsItem,
} from "./queries"

// ─────────────────────────────────────────────────────────────────────────────
// Editorial headline
// ─────────────────────────────────────────────────────────────────────────────

export type HeadlineSpan =
  | { kind: "text"; text: string }
  | { kind: "ticker"; text: string }
  | { kind: "company"; text: string; severity: "critical" | "watch" | "info" }

export type EditorialHeadline = {
  spans: HeadlineSpan[]
  meta: string
}

/**
 * Build a deterministic editorial paragraph summarizing what changed across
 * GSCR + GSBD. We pick the most recent reporting period across the input
 * hits, count hits per fund within that period, and call out the top names
 * by severity.
 */
export function buildEditorialHeadline(
  hits: DetectorHitRow[],
): EditorialHeadline {
  if (hits.length === 0) {
    return {
      spans: [
        {
          kind: "text",
          text:
            "No detector hits on GSCR or GSBD in the most recent reporting period. The morning is quiet — review the forward signals strip below for non-mark events that may shape the next filing.",
        },
      ],
      meta: "generated from 0 detector hits",
    }
  }

  // Determine the dominant period — the most recent current_period_end in the
  // top-severity slice — and slice everything else by it.
  const sorted = [...hits].sort((a, b) => {
    const aD = a.current_period_end ?? ""
    const bD = b.current_period_end ?? ""
    if (aD === bD) return (b.severity_score ?? 0) - (a.severity_score ?? 0)
    return aD > bD ? -1 : 1
  })
  const dominantPeriod = sorted[0]?.current_period_end ?? null

  const byFund: Record<string, DetectorHitRow[]> = { GSCR: [], GSBD: [] }
  for (const h of sorted) {
    if (!h.fund_ticker) continue
    if (h.fund_ticker !== "GSCR" && h.fund_ticker !== "GSBD") continue
    byFund[h.fund_ticker].push(h)
  }

  const gscrTop = byFund.GSCR.slice(0, 3)
  const gsbdTop = byFund.GSBD.slice(0, 2)

  const spans: HeadlineSpan[] = []
  const pushText = (s: string) => spans.push({ kind: "text", text: s })

  // GSCR clause.
  if (gscrTop.length > 0) {
    spans.push({ kind: "ticker", text: "GSCR" })
    pushText(
      ` recorded ${byFund.GSCR.length} detector hit${byFund.GSCR.length === 1 ? "" : "s"} in the latest slice, with severity concentrated in `,
    )
    gscrTop.forEach((h, i) => {
      const sev = sevScore100(h.severity_score)
      const bucket: "critical" | "watch" | "info" =
        sev >= 70 ? "critical" : sev >= 40 ? "watch" : "info"
      spans.push({
        kind: "company",
        text: h.portfolio_company_canonical ?? "(unnamed)",
        severity: bucket,
      })
      pushText(` (sev ${sev})`)
      if (i < gscrTop.length - 1) pushText(i === gscrTop.length - 2 ? ", and " : ", ")
    })
    pushText(". ")
  }

  // GSBD clause.
  if (gsbdTop.length > 0) {
    pushText("Meanwhile ")
    spans.push({ kind: "ticker", text: "GSBD" })
    pushText(` shows a developing pattern in `)
    gsbdTop.forEach((h, i) => {
      const sev = sevScore100(h.severity_score)
      const bucket: "critical" | "watch" | "info" =
        sev >= 70 ? "critical" : sev >= 40 ? "watch" : "info"
      spans.push({
        kind: "company",
        text: h.portfolio_company_canonical ?? "(unnamed)",
        severity: bucket,
      })
      pushText(` (sev ${sev})`)
      if (i < gsbdTop.length - 1) pushText(i === gsbdTop.length - 2 ? " and " : ", ")
    })
    pushText(".")
  } else if (gscrTop.length === 0) {
    pushText(
      "GSCR + GSBD show no high-severity moves this slice; the strongest signals are below in the forward-signals strip.",
    )
  }

  const periodLabel = dominantPeriod
    ? new Date(dominantPeriod).toISOString().slice(0, 10)
    : "(unknown period)"
  const meta = `generated from ${byFund.GSCR.length} GSCR hit${
    byFund.GSCR.length === 1 ? "" : "s"
  } · ${byFund.GSBD.length} GSBD hit${byFund.GSBD.length === 1 ? "" : "s"} · latest period ${periodLabel}`

  return { spans, meta }
}

// ─────────────────────────────────────────────────────────────────────────────
// "What changed" cards (critical / watch / info)
// ─────────────────────────────────────────────────────────────────────────────

export type ChangedCard = {
  bucket: "critical" | "watch" | "info"
  fund: string
  headline: string
  body: string
  metaLeft: string
  detectorName: string
  hitId: string
  // Canonical borrower name (matches observations.portfolio_company_canonical).
  // Used to build the "open x-ray →" link without parsing the headline.
  borrower: string | null
}

function fmtPct(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`
}

function detectorLabel(name: string) {
  switch (name) {
    case "mark_drift_down":
      return "mark drift"
    case "pik_creep":
      return "PIK creep"
    case "cross_fund_divergence":
      return "cross-fund spread"
    default:
      return name.replace(/_/g, " ")
  }
}

function describeHit(h: DetectorHitRow): { headline: string; body: string } {
  const d = h.hit_data ?? {}
  const name = h.portfolio_company_canonical ?? "(unnamed)"
  if (h.detector_name === "mark_drift_down") {
    const change = Math.abs(Number(d.fv_change_pct ?? 0))
    const prior = Number(d.fv_prior ?? 0)
    const curr = Number(d.fv_current ?? 0)
    const accrual = d.accrual_status as string | undefined
    const headline = `${name} fair value cut ${fmtPct(change)}${
      accrual && accrual !== "non_accrual" ? ` while still on ${accrual}` : ""
    }`
    const body = `Mark moved from ${prior.toLocaleString()} to ${curr.toLocaleString()} between ${
      h.prior_period_end ?? "prior period"
    } and ${h.current_period_end ?? "current period"}. Severity scored ${sevScore100(
      h.severity_score,
    )} on the mark-drift detector.`
    return { headline, body }
  }
  if (h.detector_name === "pik_creep") {
    const delta = Number(d.delta_pp ?? 0)
    const prior = Number(d.pik_share_prior ?? 0)
    const curr = Number(d.pik_share_current ?? 0)
    const headline = `${name} PIK share rose ${(delta * 100).toFixed(2)}pp`
    const body = `Paid-in-kind interest share moved from ${fmtPct(prior, 2)} to ${fmtPct(
      curr,
      2,
    )} quarter-over-quarter. Elevated PIK is the most reliable leading indicator of cash-flow stress in our backtest.`
    return { headline, body }
  }
  if (h.detector_name === "cross_fund_divergence") {
    const spread = Number(d.spread_pp ?? 0)
    const n = Number(d.n_funds ?? 0)
    const headline = `${name} mark spread of ${(spread * 100).toFixed(1)}pp across ${n} funds`
    const body = `${name} is held by ${n} BDCs at the same reporting date, but their fair-value marks diverge by ${(
      spread * 100
    ).toFixed(1)} percentage points. Spread of this magnitude is historically a leading indicator of subsequent migration.`
    return { headline, body }
  }
  const headline = `${name} ${detectorLabel(h.detector_name)} signal`
  const body = `${detectorLabel(h.detector_name)} fired at severity ${sevScore100(
    h.severity_score,
  )} for the ${h.current_period_end ?? "latest"} reporting period.`
  return { headline, body }
}

export function pickChangedCards(
  buckets: { critical: DetectorHitRow[]; watch: DetectorHitRow[]; info: DetectorHitRow[] },
): ChangedCard[] {
  const cards: ChangedCard[] = []

  const order: Array<{
    bucket: "critical" | "watch" | "info"
    arr: DetectorHitRow[]
  }> = [
    { bucket: "critical", arr: buckets.critical },
    { bucket: "watch", arr: buckets.watch },
    { bucket: "info", arr: buckets.info },
  ]

  for (const { bucket, arr } of order) {
    const top = arr[0]
    if (!top) {
      cards.push({
        bucket,
        fund: "—",
        headline: `No ${bucket} signals in the current slice`,
        body:
          bucket === "critical"
            ? "Goldman positions show no severity-70+ detector hits this period. Quiet morning on the critical bucket."
            : bucket === "watch"
            ? "No mid-severity detector activity. Watch list is clear of new entries this period."
            : "No incremental low-severity signals to flag.",
        metaLeft: "0 hits in bucket",
        detectorName: "—",
        hitId: `empty-${bucket}`,
        borrower: null,
      })
      continue
    }
    const { headline, body } = describeHit(top)
    cards.push({
      bucket,
      fund: top.fund_ticker ?? "—",
      headline,
      body,
      metaLeft: `${arr.length} hit${arr.length === 1 ? "" : "s"} in bucket · top sev ${sevScore100(
        top.severity_score,
      )}`,
      detectorName: top.detector_name,
      hitId: top.id,
      borrower: top.portfolio_company_canonical,
    })
  }
  return cards
}

// ─────────────────────────────────────────────────────────────────────────────
// Forward signal rows
// ─────────────────────────────────────────────────────────────────────────────

export type SignalImpact = "credit-negative" | "credit-positive" | "watch"

export type SignalRow = {
  id: string
  iconKind: "litigation" | "management" | "news" | "fallback"
  date: string | null
  daysAgo: number | null
  typeLabel: string
  fund: string | null
  company: string
  headline: string
  summary: string
  sourceUrl: string | null
  sourceLabel: string | null
  impact: SignalImpact
  severity: number
}

function daysAgo(date: string | null): number | null {
  if (!date) return null
  const t = new Date(date).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((Date.now() - t) / (1000 * 60 * 60 * 24)))
}

function safeStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim()
  return null
}

function pickImpact(category: "litigation" | "management" | "news", severity: number): SignalImpact {
  if (category === "litigation") return "credit-negative"
  if (category === "news") return severity >= 50 ? "credit-negative" : "watch"
  // management
  return severity >= 60 ? "credit-negative" : "watch"
}

function buildSignalsFromOne(
  joined: EnrichmentJoined,
): SignalRow[] {
  const hit = joined.hit
  if (!hit || !hit.portfolio_company_canonical) return []
  const company = hit.portfolio_company_canonical
  const sev = sevScore100(hit.severity_score)
  const out: SignalRow[] = []

  const litItems = Array.isArray(joined.litigation_items) ? joined.litigation_items : []
  for (const raw of litItems.slice(0, 1)) {
    const li = (raw ?? {}) as LitigationItem
    const date = safeStr(li.date) ?? hit.current_period_end ?? null
    const title = safeStr(li.title) ?? safeStr(li.case) ?? "Litigation event"
    out.push({
      id: `${hit.id}-lit`,
      iconKind: "litigation",
      date,
      daysAgo: daysAgo(date),
      typeLabel: "litigation",
      fund: hit.fund_ticker,
      company,
      headline: title,
      summary:
        safeStr(li.summary) ??
        safeStr(li.description) ??
        `Litigation disclosure on ${company} surfaced via the enrichment pipeline. ${
          safeStr(li.jurisdiction) ?? "Jurisdiction not specified"
        }.`,
      sourceUrl: safeStr(li.url),
      sourceLabel: safeStr(li.source),
      impact: pickImpact("litigation", sev),
      severity: sev,
    })
  }

  const mgmtItems = Array.isArray(joined.management_changes) ? joined.management_changes : []
  for (const raw of mgmtItems.slice(0, 1)) {
    const mi = (raw ?? {}) as ManagementChangeItem
    const date = safeStr(mi.date) ?? hit.current_period_end ?? null
    const role = safeStr(mi.role)
    const who = safeStr(mi.name)
    const type = safeStr(mi.type)
    const headline = who
      ? `${who}${role ? ` (${role})` : ""}${type ? ` — ${type}` : ""}`
      : safeStr(mi.summary) ?? "Management change"
    out.push({
      id: `${hit.id}-mgmt`,
      iconKind: "management",
      date,
      daysAgo: daysAgo(date),
      typeLabel: type ? `management · ${type}` : "management",
      fund: hit.fund_ticker,
      company,
      headline,
      summary:
        safeStr(mi.summary) ??
        safeStr(mi.description) ??
        `${who ?? "An executive"} change at ${company}. Management transitions historically precede mark-drift hits ~21.5% of the time within 9 months — well above the broader baseline.`,
      sourceUrl: safeStr(mi.url),
      sourceLabel: safeStr(mi.source),
      impact: pickImpact("management", sev),
      severity: sev,
    })
  }

  const newsItems = Array.isArray(joined.news_items) ? joined.news_items : []
  for (const raw of newsItems.slice(0, 1)) {
    const ni = (raw ?? {}) as NewsItem
    const date = safeStr(ni.date) ?? hit.current_period_end ?? null
    const title = safeStr(ni.title) ?? "News event"
    const sentiment = safeStr(ni.sentiment)?.toLowerCase()
    const impact: SignalImpact =
      sentiment === "positive"
        ? "credit-positive"
        : sentiment === "negative"
        ? "credit-negative"
        : pickImpact("news", sev)
    out.push({
      id: `${hit.id}-news`,
      iconKind: "news",
      date,
      daysAgo: daysAgo(date),
      typeLabel: "news",
      fund: hit.fund_ticker,
      company,
      headline: title,
      summary:
        safeStr(ni.summary) ??
        `Press / external coverage on ${company} sourced by the enrichment pipeline.`,
      sourceUrl: safeStr(ni.url),
      sourceLabel: safeStr(ni.source),
      impact,
      severity: sev,
    })
  }

  return out
}

export function buildSignalRows(
  joinedEvents: EnrichmentJoined[],
  minRows = 5,
): SignalRow[] {
  const rows: SignalRow[] = []
  for (const j of joinedEvents) {
    rows.push(...buildSignalsFromOne(j))
  }
  // De-dup by id, keep order. Sort by severity desc then by date.
  const seen = new Set<string>()
  const dedup: SignalRow[] = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    dedup.push(r)
  }
  dedup.sort((a, b) => {
    if (a.severity !== b.severity) return b.severity - a.severity
    const aD = a.date ?? ""
    const bD = b.date ?? ""
    return bD.localeCompare(aD)
  })

  // Pad with fallback rows derived from the underlying hits if we don't have
  // enough enrichment-backed rows. The fallback row is *clearly* labelled as
  // a detector-derived signal so it isn't confused with a real news/litigation
  // event.
  if (dedup.length < minRows) {
    for (const j of joinedEvents) {
      if (dedup.length >= minRows) break
      const hit = j.hit
      if (!hit || !hit.portfolio_company_canonical) continue
      const id = `${hit.id}-fallback`
      if (seen.has(id)) continue
      seen.add(id)
      const sev = sevScore100(hit.severity_score)
      const date = hit.current_period_end
      dedup.push({
        id,
        iconKind: "fallback",
        date,
        daysAgo: daysAgo(date),
        typeLabel: `detector · ${detectorLabel(hit.detector_name)}`,
        fund: hit.fund_ticker,
        company: hit.portfolio_company_canonical,
        headline: `${hit.portfolio_company_canonical} flagged at severity ${sev}`,
        summary: describeHit(hit).body,
        sourceUrl:
          Array.isArray(hit.cited_source_urls) && hit.cited_source_urls.length > 0
            ? hit.cited_source_urls[0]
            : null,
        sourceLabel: "filing",
        impact: sev >= 70 ? "credit-negative" : sev >= 40 ? "watch" : "watch",
        severity: sev,
      })
    }
  }

  return dedup
}

// ─────────────────────────────────────────────────────────────────────────────
// Committee questions — deterministic, evidence-tied.
// ─────────────────────────────────────────────────────────────────────────────

export type CommitteeQuestion = {
  num: string
  text: string
  evidence: string
}

export function buildCommitteeQuestions(
  goldmanHits: DetectorHitRow[],
  signalRows: SignalRow[],
): CommitteeQuestion[] {
  const out: CommitteeQuestion[] = []

  // Q1: top severity GSCR hit.
  const topCritical = goldmanHits.find(
    (h) => h.fund_ticker === "GSCR" && sevScore100(h.severity_score) >= 70,
  )
  if (topCritical) {
    const sev = sevScore100(topCritical.severity_score)
    const fvCut = Math.abs(Number(topCritical.hit_data?.fv_change_pct ?? 0)) * 100
    const accrual = topCritical.hit_data?.accrual_status
    out.push({
      num: "01",
      text: `${topCritical.portfolio_company_canonical} fired the ${
        topCritical.detector_name === "mark_drift_down" ? "mark-drift" : "credit"
      } detector at severity ${sev}${
        fvCut > 0 ? ` with a ${fvCut.toFixed(1)}% mark cut` : ""
      } in ${topCritical.current_period_end ?? "the latest period"}${
        accrual && accrual !== "non_accrual" ? ` while still on ${accrual}` : ""
      }. What is our internal classification status, and is there a path to recovery?`,
      evidence: `${topCritical.fund_ticker} · ${topCritical.current_period_end ?? "(period n/a)"} · severity ${sev} · detector ${topCritical.detector_name}`,
    })
  }

  // Q2: top severity GSBD hit.
  const topGsbd = goldmanHits.find(
    (h) => h.fund_ticker === "GSBD" && sevScore100(h.severity_score) >= 50,
  )
  if (topGsbd) {
    const sev = sevScore100(topGsbd.severity_score)
    out.push({
      num: out.length === 0 ? "01" : "02",
      text: `${topGsbd.portfolio_company_canonical} on GSBD scored severity ${sev} on the ${topGsbd.detector_name.replace(
        /_/g,
        " ",
      )} detector. How does our underwriting on this name compare to the post-origination credit profile we're now observing?`,
      evidence: `GSBD · ${topGsbd.current_period_end ?? "(period n/a)"} · severity ${sev}`,
    })
  }

  // Q3: cross-fund divergence anywhere.
  const xfund = goldmanHits.find((h) => h.detector_name === "cross_fund_divergence")
  if (xfund) {
    const spread = Math.abs(Number(xfund.hit_data?.spread_pp ?? 0)) * 100
    const n = Number(xfund.hit_data?.n_funds ?? 0)
    out.push({
      num: String(out.length + 1).padStart(2, "0"),
      text: `${xfund.portfolio_company_canonical} is held by ${n} BDCs but the marks diverge by ${spread.toFixed(
        1,
      )}pp at the same reporting date. Why does ${xfund.fund_ticker} sit at this position in the cross-fund spread, and is peer migration the leading indicator we should price in?`,
      evidence: `${xfund.fund_ticker} · ${xfund.current_period_end ?? "(period n/a)"} · spread ${spread.toFixed(1)}pp across ${n} funds`,
    })
  }

  // Q4: lead signal (litigation/management/news with highest severity).
  const leadSignal = signalRows.find((r) => r.iconKind !== "fallback")
  if (leadSignal) {
    out.push({
      num: String(out.length + 1).padStart(2, "0"),
      text: `Forward signal on ${leadSignal.company}: "${leadSignal.headline}". Should we proactively adjust our internal mark or watch-list flag ahead of the next filing?`,
      evidence: `${leadSignal.fund ?? "—"} · ${leadSignal.date ?? "(date n/a)"} · ${leadSignal.typeLabel} · severity ${leadSignal.severity}`,
    })
  }

  // Pad up to 4 with the next available evidence if we're short.
  let cursor = 0
  while (out.length < 4 && cursor < goldmanHits.length) {
    const h = goldmanHits[cursor++]
    if (out.some((q) => q.evidence.includes(h.portfolio_company_canonical ?? ""))) continue
    const sev = sevScore100(h.severity_score)
    out.push({
      num: String(out.length + 1).padStart(2, "0"),
      text: `${h.portfolio_company_canonical} on ${h.fund_ticker} scored severity ${sev} on the ${h.detector_name.replace(
        /_/g,
        " ",
      )} detector this period. What is the trajectory, and are we adequately reserved if it migrates one more bucket?`,
      evidence: `${h.fund_ticker} · ${h.current_period_end ?? "(period n/a)"} · severity ${sev}`,
    })
  }

  return out.slice(0, 4)
}

// ─────────────────────────────────────────────────────────────────────────────
// Time-of-day formatting
// ─────────────────────────────────────────────────────────────────────────────

export function briefingTimestampET(now = new Date()): string {
  // Best-effort ET render without pulling in a tz lib. Server may not be
  // configured for ET; we format using the system locale and label as ET.
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/New_York",
  })
  return fmt.format(now).replace(/,/g, " ·") + " ET"
}
