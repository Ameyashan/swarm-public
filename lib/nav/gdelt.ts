// GDELT DOC API client — free, no key required.
// https://api.gdeltproject.org/api/v2/doc/doc
//
// We issue one query per borrower with a quoted search term and a 1-day
// timespan. GDELT has no documented rate limit but their guidance is "be
// reasonable" — we pace at 4 req/s. Borrower alias resolution is crude in
// v1: strip corporate suffixes and prefer the dba'd name when present. A
// proper alias table is the next refinement.

const GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc"
const MIN_INTERVAL_MS = 250
let lastAt = 0

async function throttle() {
  const elapsed = Date.now() - lastAt
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed))
  }
  lastAt = Date.now()
}

const SUFFIX_RE = /\b(?:Inc\.?|LLC|L\.L\.C\.?|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|Limited|Holdings?|Holdco|Group|Partners?|LP|L\.P\.?|Plc|PLC|N\.A\.?|S\.A\.?)\b/gi

// Convert a canonical name into a tight search phrase for GDELT.
// "ABC Investment Holdco Inc. (dba ABC Plumbing)" → "ABC Plumbing"
// "CI (Quercus) Intermediate Holdings, LLC (dba SavATree)" → "SavATree"
// "Curriculum Associates, LLC" → "Curriculum Associates"
export function searchTermFor(canonical: string): string {
  const dba = canonical.match(/\(dba ([^)]+)\)/i)
  let base = dba ? dba[1] : canonical.replace(/\([^)]*\)/g, " ")
  base = base.replace(SUFFIX_RE, " ").replace(/[,]/g, " ").replace(/\s+/g, " ").trim()
  return base
}

export type GdeltArticle = {
  url: string
  title: string
  seendate: string // YYYYMMDDTHHMMSSZ
  domain?: string
  language?: string
}

export async function searchGdelt(term: string, timespan = "1d", maxRecords = 15): Promise<GdeltArticle[]> {
  if (!term || term.length < 3) return []
  await throttle()
  const q = encodeURIComponent(`"${term}"`)
  const url = `${GDELT_DOC}?query=${q}&mode=ArtList&format=JSON&maxrecords=${maxRecords}&timespan=${timespan}&sort=DateDesc`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) return []
  // GDELT sometimes returns empty body or non-JSON on no-hit queries.
  const text = await res.text()
  if (!text.trim()) return []
  let data: any
  try { data = JSON.parse(text) } catch { return [] }
  const articles = (data?.articles ?? []) as any[]
  return articles
    .filter((a) => a.language === undefined || /^Eng/i.test(a.language))
    .map((a) => ({
      url: String(a.url),
      title: String(a.title ?? ""),
      seendate: String(a.seendate ?? ""),
      domain: a.domain,
      language: a.language,
    }))
}

// Convert GDELT's "20260517T143025Z" to an ISO timestamp.
export function gdeltDateToIso(d: string): string {
  const m = d.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (!m) return new Date().toISOString()
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`
}
