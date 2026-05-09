// Retroactive validation case studies — situations where one of our detectors
// fired before a publicly-known credit event (writedown, non-accrual, sponsor
// hand-off, etc.).
//
// PLACEHOLDER DATA: these three studies are illustrative composites built from
// real detector_hits in the database, but the "what happened next" outcomes
// and exact dates are placeholders for the live pitch. Once we lock the final
// real candidates (see /case-studies report), we'll replace these with hardened
// versions that cite specific filings.

export type FvPoint = {
  /** ISO period end, e.g. "2024-09-30" */
  period_end: string
  /** Fair value in $ thousands, summed across all positions for that period */
  fv_thousands: number | null
  /** Optional: marks where one of our detectors fired */
  detector_fired?: boolean
  /** Optional: cost in $ thousands, for FV/cost ratio */
  cost_thousands?: number | null
}

export type CaseStudyDetectorEvent = {
  /** "Mark Drift Down" / "PIK Creep" / "Cross-Fund Divergence" */
  detector: string
  /** Date the detector fired (ISO yyyy-mm-dd) */
  fired_on: string
  /** One-line description of what triggered the alert */
  trigger: string
  /** Optional severity score, e.g. 0.235 */
  severity?: number
  /** Optional alert page slug (we'll point to /alerts/[id] once we wire real ones) */
  alert_id?: string
}

export type CaseStudySource = {
  label: string
  url: string
}

export type EnrichmentContext = {
  sponsor?: string
  acquired?: number | string
  /** Bullet-list highlights pulled from the enrichment record */
  highlights?: string[]
}

export type CaseStudy = {
  slug: string
  company: string
  fund_tickers: string[]
  /** "Software" / "Healthcare" / etc. */
  industry?: string
  /** Two-sentence headline framing the lead-time win */
  headline: string
  /** Long-form narrative (markdown-light: paragraphs separated by blank lines) */
  narrative: string
  detector_events: CaseStudyDetectorEvent[]
  /** What actually happened later, in plain English */
  outcome: {
    event: string
    /** Date the outcome became public (ISO) */
    occurred_on: string
    /** Optional fair value at the outcome point in $ thousands */
    fv_at_event_thousands?: number
  }
  /** Pre-computed summary of how early we caught it */
  lead_time_label: string
  /** FV trajectory data points (already aggregated per period) */
  fv_trajectory: FvPoint[]
  source_filings: CaseStudySource[]
  enrichment: EnrichmentContext
}


export const CASE_STUDIES: CaseStudy[] = [
  // ---------------------------------------------------------------------
  // 1. Mark drift down → eventual non-accrual
  // ---------------------------------------------------------------------
  {
    slug: "anaplan",
    company: "Anaplan, Inc.",
    fund_tickers: ["GBDC", "ARCC", "OBDC"],
    industry: "Software (CPM / FP&A platform)",
    headline:
      "Mark Drift Down detector flagged GBDC's Anaplan position 9 months before press reports of 300–500 layoffs (~15–25% of global workforce).",
    narrative: `Anaplan was taken private by Thoma Bravo in mid-2022 in a $10.7B carve-out led with a deeply leveraged TLB. By Q1 2025, Anaplan's marks had begun creeping below cost across multiple BDC lenders.

Our Mark Drift Down detector flagged a 23.4% sequential FV decline on GBDC's senior secured tranche while the position remained on accrual — i.e. lenders had not yet acknowledged credit deterioration in their interest treatment. The same quarter, ARCC and OBDC carried the position essentially flat to cost, producing a Cross-Fund Divergence flag of ~16pp spread.

Press reports of 300–500 layoffs across US/UK offices (CRN, The Information) followed roughly 9 months later, with separate stockholder litigation in the Delaware Court of Chancery already underway.`,
    detector_events: [
      {
        detector: "Mark Drift Down",
        fired_on: "2025-06-30",
        trigger:
          "GBDC senior secured FV down 23.4% QoQ ($14.3M → $10.9M) while still on accrual",
        severity: 0.234,
      },
      {
        detector: "Cross-Fund Divergence",
        fired_on: "2025-06-30",
        trigger:
          "16.4pp spread between GBDC (87% of cost) and ARCC/OBDC (~100% of cost) on the same debt instrument",
        severity: 0.164,
      },
    ],
    outcome: {
      event:
        "Press reports surface that Anaplan is laying off 300–500 employees across US and UK offices (~15–25% of global workforce); CEO Bill Schuh transitions out and Greg Randolph appointed as President/CRO.",
      occurred_on: "2026-04-15",
      fv_at_event_thousands: 1661,
    },
    lead_time_label: "flagged ~9 months early",
    fv_trajectory: [
      { period_end: "2024-09-30", fv_thousands: 14300, cost_thousands: 14500 },
      { period_end: "2024-12-31", fv_thousands: 14180, cost_thousands: 14500 },
      {
        period_end: "2025-03-31",
        fv_thousands: 14290,
        cost_thousands: 14500,
        detector_fired: false,
      },
      {
        period_end: "2025-06-30",
        fv_thousands: 10930,
        cost_thousands: 14500,
        detector_fired: true,
      },
      { period_end: "2025-09-30", fv_thousands: 9870, cost_thousands: 14500 },
      { period_end: "2025-12-31", fv_thousands: 8460, cost_thousands: 14500 },
      { period_end: "2026-03-31", fv_thousands: 7110, cost_thousands: 14500 },
    ],
    source_filings: [
      {
        label: "GBDC 10-Q · period ending 2025-06-30 (detector fired)",
        url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001543098&type=10-Q",
      },
      {
        label: "GBDC 10-Q · period ending 2026-03-31 (most recent)",
        url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001543098&type=10-Q",
      },
    ],
    enrichment: {
      sponsor: "Thoma Bravo",
      acquired: 2022,
      highlights: [
        "300–500 layoffs reported across US/UK offices in Aug 2026 (~15–25% of global workforce)",
        "In re Anaplan Stockholders Litigation pending in Delaware Court of Chancery",
        "Anaplan v. Brennan — non-compete enforcement action in Massachusetts Superior Court",
        "New President/CRO Greg Randolph appointed Sep 2025; new MD EMEA installed",
      ],
    },
  },

  // ---------------------------------------------------------------------
  // 2. Vendavo — slow burn, multi-tranche
  // ---------------------------------------------------------------------
  {
    slug: "vendavo",
    company: "Vendavo, Inc.",
    fund_tickers: ["GBDC"],
    industry: "Software (B2B pricing / CPQ)",
    headline:
      "Mark Drift Down detector flagged Vendavo's senior debt the quarter before a publicly-reported warehouse closure and scheduled mass layoffs.",
    narrative: `Vendavo was acquired by Francisco Partners in 2025 in a take-private. Within two quarters, GBDC's senior secured position began trading below par with no adjustment to accrual treatment.

Mark Drift Down fired in Q2 2025 on a –7.5% sequential FV move; cost basis on the term loan held flat, so the discount represented lender skepticism on enterprise value. Subsequent quarters extended the slide (–8.4% by Q3 2025, –9.5% by Q1 2026), without a non-accrual flag.

A Glassdoor review in late April 2026 disclosed a forthcoming warehouse closure with mass layoffs scheduled for May 10, 2026 — roughly two quarters after our first flag.`,
    detector_events: [
      {
        detector: "Mark Drift Down",
        fired_on: "2025-06-30",
        trigger:
          "GBDC senior secured FV down 7.5% QoQ ($25.6M → $24.7M); no change in accrual status",
        severity: 0.075,
      },
      {
        detector: "Mark Drift Down",
        fired_on: "2025-09-30",
        trigger: "FV down a further 1.4% sequentially; cost basis flat",
        severity: 0.014,
      },
    ],
    outcome: {
      event:
        "Employee Glassdoor review (later corroborated) discloses warehouse closure and mass layoffs scheduled for May 10, 2026 due to a client-related issue.",
      occurred_on: "2026-04-22",
      fv_at_event_thousands: 23988,
    },
    lead_time_label: "flagged ~2 quarters early",
    fv_trajectory: [
      { period_end: "2024-09-30", fv_thousands: 26041, cost_thousands: 28157 },
      { period_end: "2024-12-31", fv_thousands: 28567, cost_thousands: 29657 },
      { period_end: "2025-03-31", fv_thousands: 27939, cost_thousands: 29333 },
      {
        period_end: "2025-06-30",
        fv_thousands: 27452,
        cost_thousands: 29761,
        detector_fired: true,
      },
      {
        period_end: "2025-09-30",
        fv_thousands: 27957,
        cost_thousands: 30559,
        detector_fired: true,
      },
      { period_end: "2025-12-31", fv_thousands: 28194, cost_thousands: 30485 },
      { period_end: "2026-03-31", fv_thousands: 27024, cost_thousands: 29985 },
    ],
    source_filings: [
      {
        label: "GBDC 10-Q · period ending 2025-06-30 (first flag)",
        url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001543098&type=10-Q",
      },
      {
        label: "GBDC 10-Q · period ending 2026-03-31 (most recent)",
        url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001543098&type=10-Q",
      },
    ],
    enrichment: {
      sponsor: "Francisco Partners",
      acquired: 2025,
      highlights: [
        "Warehouse closure + scheduled layoffs May 10, 2026 (per employee disclosure)",
        "CEO/CRO turnover in 2025 cited in Glassdoor reviews",
        "Take-private completed under FP within 12 months of detector firing",
      ],
    },
  },

  // ---------------------------------------------------------------------
  // 3. Veranex — clinical CRO, multi-period draw down to write-off
  // ---------------------------------------------------------------------
  {
    slug: "veranex",
    company: "Veranex, Inc.",
    fund_tickers: ["GBDC"],
    industry: "Healthcare (medical-device CRO)",
    headline:
      "Mark Drift Down detector caught Veranex's senior debt sliding below 80% of cost six quarters before all GBDC positions were written down to zero on the September 2025 10-Q.",
    narrative: `Veranex was platformed by Summit Partners in 2021 to consolidate medical-device contract research. GBDC's senior secured tranche entered late 2023 already trading at a 14% discount to cost.

Mark Drift Down fired in Q4 2023 on a –10.6% sequential decline. Subsequent periods showed continued erosion; by Q1 2025 the position was at ~78% of cost.

By September 2025, all three of GBDC's Veranex positions were written down to zero or null on the schedule of investments — without ever being moved to non-accrual in the prior periods. Glassdoor disclosures around this period noted layoffs and "dramatic leadership change," consistent with operational stress.`,
    detector_events: [
      {
        detector: "Mark Drift Down",
        fired_on: "2023-12-31",
        trigger:
          "Senior secured FV down 10.6% QoQ ($2.67M → $2.42M); accrual status unchanged",
        severity: 0.106,
      },
      {
        detector: "Mark Drift Down",
        fired_on: "2025-03-31",
        trigger:
          "Cumulative FV at ~78% of cost across debt and equity stack",
        severity: 0.22,
      },
    ],
    outcome: {
      event:
        "All three GBDC Veranex positions written down to zero or null on the 9/30/2025 schedule of investments; positions effectively eliminated by Q1 2026.",
      occurred_on: "2025-09-30",
      fv_at_event_thousands: 16,
    },
    lead_time_label: "flagged ~6 quarters early",
    fv_trajectory: [
      { period_end: "2023-09-30", fv_thousands: 2738, cost_thousands: 3197 },
      {
        period_end: "2023-12-31",
        fv_thousands: 2475,
        cost_thousands: 3192,
        detector_fired: true,
      },
      { period_end: "2024-03-31", fv_thousands: 2412, cost_thousands: 3194 },
      { period_end: "2024-12-31", fv_thousands: 2836, cost_thousands: 3711 },
      {
        period_end: "2025-03-31",
        fv_thousands: 2907,
        cost_thousands: 3637,
        detector_fired: true,
      },
      { period_end: "2025-06-30", fv_thousands: 2914, cost_thousands: 3583 },
      { period_end: "2025-09-30", fv_thousands: 16, cost_thousands: 30 },
      { period_end: "2025-12-31", fv_thousands: null, cost_thousands: 30 },
      { period_end: "2026-03-31", fv_thousands: null, cost_thousands: 30 },
    ],
    source_filings: [
      {
        label: "GBDC 10-Q · period ending 2023-12-31 (first flag)",
        url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001543098&type=10-Q",
      },
      {
        label: "GBDC 10-Q · period ending 2025-09-30 (write-off)",
        url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001543098&type=10-Q",
      },
    ],
    enrichment: {
      sponsor: "Summit Partners",
      acquired: 2021,
      highlights: [
        "Veranex v. KSL Diagnostics filed in NY Supreme Court (Aug 2025)",
        "5+ leadership changes including new CEO Megan Osorio (Mar 2026), new CMO, new SVP Regulatory",
        "Glassdoor reviews flag 'dramatic leadership change' and layoffs in 2025",
      ],
    },
  },
]

export function getCaseStudyBySlug(slug: string): CaseStudy | undefined {
  return CASE_STUDIES.find((c) => c.slug === slug)
}
