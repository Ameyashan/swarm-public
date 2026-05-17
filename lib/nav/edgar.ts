// Minimal EDGAR client — TS port of python-pipeline/edgar_client.py.
// Honors SEC's 10 req/s limit by pacing at ~7 req/s and sends a descriptive
// User-Agent (required by EDGAR access guidelines).

const EDGAR_BASE = "https://data.sec.gov"
const ARCHIVES_BASE = "https://www.sec.gov/Archives"
const USER_AGENT = process.env.EDGAR_USER_AGENT ?? "Swarm Public ameya.shanbhag@gmail.com"

const MIN_INTERVAL_MS = 150
let lastAt = 0

async function throttle() {
  const elapsed = Date.now() - lastAt
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed))
  }
  lastAt = Date.now()
}

async function get(url: string, accept = "application/json"): Promise<Response> {
  await throttle()
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Encoding": "gzip, deflate",
      Accept: accept,
    },
  })
  if (!res.ok) throw new Error(`EDGAR ${res.status} ${url}`)
  return res
}

function padCik(cik: string): string {
  return cik.replace(/\D/g, "").padStart(10, "0")
}

export type RecentFiling = {
  form: string
  accession_number: string
  filing_date: string
  primary_document: string
  items: string[] // 8-K item codes, e.g. ["1.03", "5.02"]; empty for other forms
  url: string
}

export async function getRecent8Ks(cik: string, sinceIsoDate: string, limit = 20): Promise<RecentFiling[]> {
  const padded = padCik(cik)
  const res = await get(`${EDGAR_BASE}/submissions/CIK${padded}.json`)
  const data = (await res.json()) as any
  const recent = data?.filings?.recent ?? {}
  const forms: string[] = recent.form ?? []
  const accs: string[] = recent.accessionNumber ?? []
  const dates: string[] = recent.filingDate ?? []
  const primaries: string[] = recent.primaryDocument ?? []
  const items: string[] = recent.items ?? [] // comma-joined per filing for 8-Ks
  const cikInt = String(parseInt(padded, 10))
  const out: RecentFiling[] = []
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== "8-K") continue
    if (dates[i] < sinceIsoDate) continue
    const accNoDash = (accs[i] ?? "").replace(/-/g, "")
    out.push({
      form: forms[i],
      accession_number: accs[i],
      filing_date: dates[i],
      primary_document: primaries[i],
      items: (items[i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d+(?:\.\d+)?$/.test(s)),
      url: `${ARCHIVES_BASE}/edgar/data/${cikInt}/${accNoDash}/${primaries[i]}`,
    })
    if (out.length >= limit) break
  }
  return out
}
