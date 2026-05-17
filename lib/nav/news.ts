// News-event scoring for the daily NAV idio signal.
//
// Rules-first: a deterministic table maps 8-K item codes and headline regex
// hits to a severity in 0..100. Rows that match nothing fall through to an
// LLM fallback (Claude Haiku) which returns {severity, reason}. The cron
// caller decides whether to actually invoke the LLM (cost gate via a
// pre-filter); this module is pure scoring.

export type NewsItem = {
  source: "edgar_8k" | "headline_feed" | "google_news"
  source_id: string
  portfolio_company_canonical: string
  fund_ticker?: string | null
  title: string
  body?: string | null
  url?: string | null
  item_codes?: string[] | null
  published_at: string
}

export type Score = {
  severity_100: number // 0..100; only ≥70 fires idio in methodology.ts
  reason: string
  method: "rule" | "llm" | "skip"
  matched: string | null // rule id or null
}

// 8-K item severities — calibrated against methodology.ts thresholds:
// ≥95 → −10% idio, 85–94 → −5% to −10%, 70–84 → −1% to −5%, <70 → ignored.
const ITEM_SEVERITY: Record<string, { sev: number; reason: string }> = {
  "1.03": { sev: 95, reason: "8-K Item 1.03 — bankruptcy / receivership" },
  "2.04": { sev: 88, reason: "8-K Item 2.04 — acceleration / increase of direct financial obligation" },
  "4.02": { sev: 82, reason: "8-K Item 4.02 — non-reliance on previously issued financials" },
  "3.01": { sev: 78, reason: "8-K Item 3.01 — failure to satisfy listing standards" },
  "2.06": { sev: 80, reason: "8-K Item 2.06 — material impairment" },
  "2.05": { sev: 74, reason: "8-K Item 2.05 — costs associated with exit / disposal activities" },
  "5.02": { sev: 72, reason: "8-K Item 5.02 — officer departure" },
}

// Headline keyword rules. Order matters — first match wins.
const HEADLINE_RULES: Array<{ id: string; pattern: RegExp; sev: number; reason: string }> = [
  { id: "bankruptcy",       pattern: /\b(chapter\s*11|chapter\s*7|bankrupt|files? for protection)\b/i, sev: 95, reason: "bankruptcy headline" },
  { id: "default",          pattern: /\b(default(?:s|ed)?|missed (?:payment|coupon|interest)|payment default)\b/i, sev: 90, reason: "payment default" },
  { id: "going_concern",    pattern: /\bgoing concern\b/i, sev: 88, reason: "going-concern qualification" },
  { id: "covenant_breach",  pattern: /\bcovenant (breach|violation|waiver)\b/i, sev: 85, reason: "covenant breach / waiver" },
  { id: "downgrade",        pattern: /\b(downgrade(?:s|d)?|cut(?:s|ting)? rating|negative watch)\b/i, sev: 78, reason: "rating downgrade" },
  { id: "restatement",      pattern: /\b(restate(?:s|d|ment)|non[- ]reliance)\b/i, sev: 80, reason: "financial restatement" },
  { id: "layoffs",          pattern: /\b(lay ?off|workforce reduction|riffe?d|cut\s+\d+%?\s+of\s+(staff|workforce|jobs))\b/i, sev: 74, reason: "layoffs / workforce reduction" },
  { id: "guidance_cut",     pattern: /\b(cuts? (?:full[- ]year )?guidance|lowers? (?:outlook|forecast)|guides? down)\b/i, sev: 72, reason: "guidance cut" },
  { id: "earnings_miss",    pattern: /\b(misses? (?:revenue|earnings|estimates)|earnings miss)\b/i, sev: 70, reason: "earnings miss" },
]

export function classifyByRules(item: NewsItem): Score | null {
  if (item.source === "edgar_8k" && item.item_codes?.length) {
    let best: { sev: number; reason: string; code: string } | null = null
    for (const code of item.item_codes) {
      const rec = ITEM_SEVERITY[code]
      if (rec && (!best || rec.sev > best.sev)) best = { ...rec, code }
    }
    if (best) return { severity_100: best.sev, reason: best.reason, method: "rule", matched: `item_${best.code}` }
  }
  const text = `${item.title} ${item.body ?? ""}`
  for (const r of HEADLINE_RULES) {
    if (r.pattern.test(text)) {
      return { severity_100: r.sev, reason: r.reason, method: "rule", matched: r.id }
    }
  }
  return null
}

// LLM fallback. Caller passes an Anthropic client + model id. Kept here as a
// pure function so the cron route can mock it in tests. Pre-filtering (only
// pass items that mention a borrower AND a risk-ish keyword) is the caller's
// job; this function does no cost-gating.
export async function classifyByLlm(
  item: NewsItem,
  call: (prompt: string) => Promise<string>,
): Promise<Score> {
  const prompt = [
    "You score borrower-credit news for a private-credit BDC analyst.",
    "Return ONLY a JSON object: {\"severity\": <0-100 int>, \"reason\": \"<one short clause>\"}.",
    "Anchor points:",
    "  95 = bankruptcy / receivership",
    "  88 = payment default, going-concern",
    "  82 = financial restatement, material impairment",
    "  75 = layoffs, guidance cut, downgrade",
    "  60 = ambiguous negative (under 70 will be ignored)",
    "  30 = neutral / positive",
    `Borrower: ${item.portfolio_company_canonical}`,
    `Title: ${item.title}`,
    item.body ? `Body: ${item.body.slice(0, 800)}` : "",
  ].filter(Boolean).join("\n")
  const raw = await call(prompt)
  try {
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw)
    const sev = Math.max(0, Math.min(100, Math.round(Number(parsed.severity))))
    const reason = String(parsed.reason ?? "llm classification").slice(0, 200)
    return { severity_100: sev, reason, method: "llm", matched: null }
  } catch {
    return { severity_100: 0, reason: "llm parse failed", method: "llm", matched: null }
  }
}

// Pre-filter for the LLM cost gate. Caller should LLM-classify only items
// that pass this — borrower name in text AND at least one risk-adjacent
// keyword. Tunable list; intentionally broader than the deterministic rules.
const LLM_KEYWORDS = /\b(loss|cut|sue(d|s)?|lawsuit|probe|investigat|delay|warn|down|debt|recall|fraud|miss|weak|decline|drop|fall|fire|resign|exit|hostile|distress|liquid|wind[- ]down)/i

export function shouldLlmClassify(item: NewsItem): boolean {
  const text = `${item.title} ${item.body ?? ""}`.toLowerCase()
  if (!text.includes(item.portfolio_company_canonical.toLowerCase().split(",")[0].split(" ")[0])) {
    // crude name-match; the cron should do a proper alias match before calling
    return false
  }
  return LLM_KEYWORDS.test(text)
}
