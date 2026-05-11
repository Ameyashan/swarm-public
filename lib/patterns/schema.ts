// Pattern filter schema + validator.
// Shape matches the contract in the Commit 5 spec exactly. We keep this
// dependency-free (no zod) — the codebase otherwise avoids extra deps and the
// LLM output surface is small enough to validate by hand.

export type FundTicker = "GSCR" | "GSBD"
export type EventType = "litigation" | "management" | "news" | "none"
export type AccrualStatus = "accrual" | "non_accrual"

export type PatternFilters = {
  funds: FundTicker[] | null
  event_types: EventType[] | null
  window_days: number | null
  severity_min: number | null
  industry: string | null
  sponsor: string | null
  accrual_status: AccrualStatus | null
  pik_min_pct: number | null
  held_by_n_funds_min: number | null
}

export type ParsedField = {
  key: keyof PatternFilters
  confidence: "high" | "guess"
}

export type ParsedQuery = {
  filters: PatternFilters
  // Tells the UI which chips should render as dashed/amber (guess) vs solid.
  field_confidence: Partial<Record<keyof PatternFilters, "high" | "guess">>
  // Short rationale text the model produced to explain its parse.
  rationale?: string | null
}

export const EMPTY_FILTERS: PatternFilters = {
  funds: null,
  event_types: null,
  window_days: null,
  severity_min: null,
  industry: null,
  sponsor: null,
  accrual_status: null,
  pik_min_pct: null,
  held_by_n_funds_min: null,
}

const FUNDS = new Set(["GSCR", "GSBD"])
const EVENTS = new Set(["litigation", "management", "news", "none"])
const ACCRUAL = new Set(["accrual", "non_accrual"])
const CONFIDENCE = new Set(["high", "guess"])

function asStringArrayOr<T extends string>(
  v: unknown,
  allowed: Set<string>,
): T[] | null {
  if (v == null) return null
  if (!Array.isArray(v)) return null
  const out: T[] = []
  for (const item of v) {
    if (typeof item !== "string") continue
    const up = item.trim()
    if (allowed.has(up)) out.push(up as T)
    else if (allowed.has(up.toUpperCase())) out.push(up.toUpperCase() as T)
    else if (allowed.has(up.toLowerCase())) out.push(up.toLowerCase() as T)
  }
  return out.length === 0 ? null : out
}

function asEnumOr<T extends string>(
  v: unknown,
  allowed: Set<string>,
): T | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  if (allowed.has(s)) return s as T
  if (allowed.has(s.toLowerCase())) return s.toLowerCase() as T
  return null
}

function asNumOrNull(v: unknown, min?: number, max?: number): number | null {
  if (v == null) return null
  const n = typeof v === "string" ? Number(v) : (v as number)
  if (typeof n !== "number" || !Number.isFinite(n)) return null
  if (min != null && n < min) return null
  if (max != null && n > max) return null
  return n
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  if (!s) return null
  if (s.toLowerCase() === "null" || s.toLowerCase() === "none") return null
  return s
}

/**
 * Validate + coerce a JSON value (typically from the Anthropic API) into a
 * `ParsedQuery`. Never throws — returns `EMPTY_FILTERS` if the input is unusable.
 */
export function validateParsedQuery(raw: unknown): ParsedQuery {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>

  const filters: PatternFilters = {
    funds: asStringArrayOr<FundTicker>(r.funds, FUNDS),
    event_types: asStringArrayOr<EventType>(r.event_types, EVENTS),
    window_days: asNumOrNull(r.window_days, 1, 3650),
    severity_min: asNumOrNull(r.severity_min, 0, 100),
    industry: asStringOrNull(r.industry),
    sponsor: asStringOrNull(r.sponsor),
    accrual_status: asEnumOr<AccrualStatus>(r.accrual_status, ACCRUAL),
    pik_min_pct: asNumOrNull(r.pik_min_pct, 0, 100),
    held_by_n_funds_min: asNumOrNull(r.held_by_n_funds_min, 1, 20),
  }

  const fc: ParsedQuery["field_confidence"] = {}
  const rawFc = (r.field_confidence ?? {}) as Record<string, unknown>
  if (rawFc && typeof rawFc === "object") {
    for (const k of Object.keys(filters) as (keyof PatternFilters)[]) {
      const v = asEnumOr<"high" | "guess">(rawFc[k], CONFIDENCE)
      if (v) fc[k] = v
    }
  }

  return {
    filters,
    field_confidence: fc,
    rationale: asStringOrNull(r.rationale),
  }
}

/** Human label for a chip value — used in the parsed-interpretation row. */
export function chipLabel(
  key: keyof PatternFilters,
  filters: PatternFilters,
): string | null {
  const v = filters[key]
  if (v == null) return null
  switch (key) {
    case "funds":
      return (v as FundTicker[]).join(" + ")
    case "event_types":
      return (v as EventType[])
        .map((e) =>
          e === "management"
            ? "management changes"
            : e === "litigation"
            ? "litigation"
            : e === "news"
            ? "news"
            : "no events",
        )
        .join(" + ")
    case "window_days":
      return `last ${v} days`
    case "severity_min":
      return `severity ≥ ${v}`
    case "industry":
      return String(v)
    case "sponsor":
      return String(v)
    case "accrual_status":
      return v === "non_accrual" ? "non-accrual" : "accrual"
    case "pik_min_pct":
      return `PIK ≥ ${v}%`
    case "held_by_n_funds_min":
      return `held by ≥ ${v} funds`
    default:
      return null
  }
}

export const CHIP_KEYS: (keyof PatternFilters)[] = [
  "funds",
  "event_types",
  "window_days",
  "severity_min",
  "industry",
  "sponsor",
  "accrual_status",
  "pik_min_pct",
  "held_by_n_funds_min",
]

export const CHIP_KEY_LABEL: Record<keyof PatternFilters, string> = {
  funds: "fund",
  event_types: "event",
  window_days: "window",
  severity_min: "severity",
  industry: "industry",
  sponsor: "sponsor",
  accrual_status: "accrual",
  pik_min_pct: "PIK",
  held_by_n_funds_min: "held by",
}
