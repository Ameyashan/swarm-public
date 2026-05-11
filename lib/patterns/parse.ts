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
