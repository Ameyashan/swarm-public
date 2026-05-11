import "server-only"

import { validateParsedQuery, type ParsedQuery, EMPTY_FILTERS } from "./schema"

// ─────────────────────────────────────────────────────────────────────────────
// Pattern composer parser — calls the Anthropic API and produces a structured
// PatternFilters JSON object. Never executes user-supplied SQL.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-20250514"
const ENDPOINT = "https://api.anthropic.com/v1/messages"

const SYSTEM_PROMPT = `You translate a private-credit portfolio manager's plain-English question into a STRUCTURED JSON FILTER. The PM manages Goldman Sachs BDC funds GSCR and GSBD on top of a database of detector hits + enrichments across BDC quarterly filings.

Return ONLY a single JSON object — no prose, no markdown fences. The object MUST have these keys (use null when the user did not specify or you cannot confidently infer):

{
  "funds": ["GSCR","GSBD"] | null,
  "event_types": ["litigation"|"management"|"news"|"none"] | null,
  "window_days": <int> | null,
  "severity_min": <int 0-100> | null,
  "industry": <string> | null,
  "sponsor": <string> | null,
  "accrual_status": "accrual" | "non_accrual" | null,
  "pik_min_pct": <number 0-100> | null,
  "held_by_n_funds_min": <int> | null,
  "field_confidence": { "<key>": "high" | "guess" },
  "rationale": <short string>
}

Rules:
- If the user says "Goldman" or doesn't name a fund, default funds to ["GSCR","GSBD"] with confidence "high".
- "mark cut/markdown >= N%" → severity_min ≈ N (severity is 0-100 here, mark cuts of 30%+ generally map to severity 30+). Mark as guess unless the user gave a precise severity number.
- "last 6 months" → window_days: 180. "last quarter" → 90. "this year" → 365. Mark window_days as a guess if the user said "lately/recently".
- "non-accrual" / "NA" → accrual_status: "non_accrual" (high).
- "PIK above N" / "PIK > N%" → pik_min_pct: N (high).
- "held by 3+ BDCs" / "cross-held by N funds" → held_by_n_funds_min: N (high).
- Sponsor names (e.g. "Sun Capital", "Harvest Partners", "Vista", "Audax") → sponsor (high).
- Industry strings (e.g. "software", "healthcare providers", "consumer services") → industry (high).
- If the user is asking about no/zero events ("companies with no recent hits"), event_types may be ["none"].
- field_confidence keys must mirror the keys you populated. Omit confidence for null fields. Mark a key as "guess" when you inferred it rather than read it from the prompt.
- rationale: one sentence in plain English explaining your interpretation, including which fields were guesses.

Do not include any other keys. Do not wrap the JSON in markdown.`

export type ParseResult =
  | { ok: true; parsed: ParsedQuery; elapsedMs: number }
  | { ok: false; error: string }

/**
 * Parse a natural-language pattern query via the Anthropic API.
 * Returns structured filters. Validates output before returning.
 */
export async function parsePatternQuery(query: string): Promise<ParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is not set on the server. Set it in your environment to enable the composer.",
    }
  }

  const trimmed = query.trim()
  if (!trimmed) {
    return { ok: true, parsed: { filters: EMPTY_FILTERS, field_confidence: {} }, elapsedMs: 0 }
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
  const url = baseUrl.replace(/\/$/, "") + "/v1/messages"

  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: trimmed }],
      }),
      // Edge runtimes can otherwise stall waiting for body. 20s ceiling.
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    return {
      ok: false,
      error: `Anthropic API request failed: ${(e as Error).message}`,
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return {
      ok: false,
      error: `Anthropic API returned ${res.status}: ${body.slice(0, 300)}`,
    }
  }

  let payload: any
  try {
    payload = await res.json()
  } catch (e) {
    return { ok: false, error: "Anthropic API returned non-JSON body." }
  }

  // Extract the text part(s) from the messages response.
  const text = Array.isArray(payload?.content)
    ? payload.content
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join("")
    : ""

  // Find the first JSON object in the model output.
  const jsonStart = text.indexOf("{")
  const jsonEnd = text.lastIndexOf("}")
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return {
      ok: false,
      error: "Model did not return JSON. Try rephrasing the query.",
    }
  }
  const jsonSlice = text.slice(jsonStart, jsonEnd + 1)

  let parsedRaw: unknown
  try {
    parsedRaw = JSON.parse(jsonSlice)
  } catch (e) {
    return { ok: false, error: "Model returned invalid JSON." }
  }

  const parsed = validateParsedQuery(parsedRaw)
  return { ok: true, parsed, elapsedMs: Date.now() - t0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic fallback parser. Runs without the Anthropic API key, so the
// composer keeps working in environments where the key isn't configured.
// Output shape is identical to `parsePatternQuery` so the UI is unchanged.
// Fields that we read straight out of the user's text get confidence
// "high"; defaults (e.g. defaulting funds to Goldman) get "guess" so the
// chip renders dashed.
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_SPONSORS = [
  "Sun Capital",
  "Harvest Partners",
  "Vista",
  "Audax",
  "Blackstone",
  "Apollo",
  "KKR",
  "TPG",
  "Thoma Bravo",
  "Bain Capital",
  "Bain",
  "Carlyle",
  "Warburg",
  "Insight",
  "Hellman & Friedman",
  "Advent",
]

// Industry keywords sourced from the top observations.industry_canonical
// values in our dataset. We accept short keyword forms ("software") and
// normalize to a canonical label the SQL composer will match against.
const INDUSTRY_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bsoftware\b/i, label: "Software" },
  { pattern: /\bhealthcare providers?\b|\bhealthcare services?\b/i, label: "Healthcare Providers & Services" },
  { pattern: /\bhealthcare\b/i, label: "Healthcare" },
  { pattern: /\bconsumer services?\b/i, label: "Diversified Consumer Services" },
  { pattern: /\binsurance\b/i, label: "Insurance" },
  { pattern: /\bIT services?\b/i, label: "IT Services" },
  { pattern: /\bmedia\b/i, label: "Media" },
  { pattern: /\bbiotech(nology)?\b/i, label: "Biotechnology" },
  { pattern: /\bcommercial services?\b/i, label: "Commercial Services & Supplies" },
  { pattern: /\bprofessional services?\b/i, label: "Professional Services" },
  { pattern: /\bchemicals?\b/i, label: "Chemicals" },
  { pattern: /\bmachinery\b/i, label: "Machinery" },
  { pattern: /\bbuilding products?\b/i, label: "Building Products" },
  { pattern: /\bdistributors?\b/i, label: "Distributors" },
  { pattern: /\baerospace\b|\bdefense\b/i, label: "Aerospace & Defense" },
]

function matchSponsor(text: string): string | null {
  const lower = text.toLowerCase()
  for (const s of KNOWN_SPONSORS) {
    if (lower.includes(s.toLowerCase())) return s
  }
  return null
}

function matchIndustry(text: string): string | null {
  for (const { pattern, label } of INDUSTRY_KEYWORDS) {
    if (pattern.test(text)) return label
  }
  return null
}

function matchWindowDays(text: string): number | null {
  // Named windows take priority — they're unambiguous.
  if (/\bthis quarter\b|\blast quarter\b/i.test(text)) return 90
  if (/\blast year\b|\bpast year\b|\bin the last 12 months?\b|\bthis year\b/i.test(text)) return 365
  if (/\blast (?:6|six) months?\b/i.test(text)) return 180
  if (/\blast month\b/i.test(text)) return 30
  // Generic "last N days/weeks/months/years".
  const m = text.match(/\b(?:last|past|in the last)\s+(\d+)\s+(day|week|month|year)s?\b/i)
  if (m) {
    const n = Number(m[1])
    if (!Number.isFinite(n)) return null
    const unit = m[2].toLowerCase()
    if (unit === "day") return n
    if (unit === "week") return n * 7
    if (unit === "month") return n * 30
    if (unit === "year") return n * 365
  }
  return null
}

function matchSeverityMin(text: string): number | null {
  const m = text.match(/severity\s*(?:>=|>|above|over|of|at\s+least)?\s*(\d{1,3})/i)
  if (m) {
    const n = Math.max(0, Math.min(100, Number(m[1])))
    if (Number.isFinite(n)) return n
  }
  // "mark cut/markdown of N%" maps roughly to severity ≈ N (lossy).
  const m2 = text.match(/mark\s*(?:cut|drop|down|down\s*by)?\s*(?:>=|>|of|above|over)?\s*(\d{1,3})\s*%/i)
  if (m2) {
    const n = Math.max(0, Math.min(100, Number(m2[1])))
    if (Number.isFinite(n)) return n
  }
  return null
}

function matchPik(text: string): number | null {
  const m = text.match(/\bPIK\b[^.\d]*?(?:>=|>|above|over|of)?\s*(\d{1,3}(?:\.\d+)?)\s*%?/i)
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n <= 100) return n
  }
  return null
}

function matchHeldByN(text: string): number | null {
  const m = text.match(/\b(?:held by|cross[- ]?held by|across)\s*(\d+)\s*\+?\s*(?:BDCs?|funds?)\b/i)
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n >= 1) return n
  }
  return null
}

function matchAccrual(text: string): "accrual" | "non_accrual" | null {
  if (/\bnon[- ]?accrual\b|\bnon accruals?\b/i.test(text)) return "non_accrual"
  if (/\bNA borrowers?\b|\bon NA\b/i.test(text)) return "non_accrual"
  if (/\bon accrual\b|\baccruing\b/i.test(text)) return "accrual"
  return null
}

function matchEventTypes(text: string): Array<"litigation" | "management" | "news" | "none"> | null {
  const out: Array<"litigation" | "management" | "news" | "none"> = []
  if (/\blitigation\b|\blawsuit\b|\bsued?\b|\bplaintiff\b|\bcourt\b/i.test(text)) out.push("litigation")
  if (/\bmanagement\b|\bexec(utive)?\b|\bCEO\b|\bCFO\b|\bCOO\b|\bdeparted\b|\bdeparture\b|\bappoint(ed|ment)\b/i.test(text)) out.push("management")
  if (/\bnews\b|\bpress\b|\barticle\b|\bheadline\b/i.test(text)) out.push("news")
  if (/\bno events?\b|\bzero events?\b|\bno hits?\b/i.test(text)) {
    return ["none"]
  }
  return out.length === 0 ? null : out
}

function matchFunds(text: string): {
  funds: ("GSCR" | "GSBD")[] | null
  defaulted: boolean
} {
  const out: Set<"GSCR" | "GSBD"> = new Set()
  if (/\bGSCR\b/i.test(text)) out.add("GSCR")
  if (/\bGSBD\b/i.test(text)) out.add("GSBD")
  if (out.size === 0 && /\bGoldman\b/i.test(text)) {
    out.add("GSCR")
    out.add("GSBD")
  }
  if (out.size === 0) {
    // Default to both Goldman funds — but mark as guess so the chip is dashed.
    return { funds: ["GSCR", "GSBD"], defaulted: true }
  }
  return { funds: Array.from(out), defaulted: false }
}

export function parsePatternQueryHeuristic(query: string): ParseResult {
  const t0 = Date.now()
  const text = query.trim()
  if (!text) {
    return { ok: true, parsed: { filters: EMPTY_FILTERS, field_confidence: {} }, elapsedMs: 0 }
  }

  const filters: typeof EMPTY_FILTERS = { ...EMPTY_FILTERS }
  const fc: Partial<Record<keyof typeof EMPTY_FILTERS, "high" | "guess">> = {}

  const fundsMatch = matchFunds(text)
  filters.funds = fundsMatch.funds
  if (filters.funds) fc.funds = fundsMatch.defaulted ? "guess" : "high"

  const events = matchEventTypes(text)
  if (events) {
    filters.event_types = events
    fc.event_types = "high"
  }

  const window = matchWindowDays(text)
  if (window != null) {
    filters.window_days = window
    fc.window_days = /\b(lately|recently)\b/i.test(text) ? "guess" : "high"
  }

  const sev = matchSeverityMin(text)
  if (sev != null) {
    filters.severity_min = sev
    fc.severity_min = "high"
  }

  const industry = matchIndustry(text)
  if (industry) {
    filters.industry = industry
    fc.industry = "high"
  }

  const sponsor = matchSponsor(text)
  if (sponsor) {
    filters.sponsor = sponsor
    fc.sponsor = "high"
  }

  const accrual = matchAccrual(text)
  if (accrual) {
    filters.accrual_status = accrual
    fc.accrual_status = "high"
  }

  const pik = matchPik(text)
  if (pik != null) {
    filters.pik_min_pct = pik
    fc.pik_min_pct = "high"
  }

  const heldBy = matchHeldByN(text)
  if (heldBy != null) {
    filters.held_by_n_funds_min = heldBy
    fc.held_by_n_funds_min = "high"
  }

  const rationale =
    "Parsed locally (no LLM). Funds defaulted to Goldman when not explicitly named. Set ANTHROPIC_API_KEY on the server to enable richer interpretation."

  return {
    ok: true,
    parsed: { filters, field_confidence: fc, rationale },
    elapsedMs: Date.now() - t0,
  }
}
