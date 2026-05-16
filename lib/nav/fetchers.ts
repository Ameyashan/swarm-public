import "server-only"

// Daily benchmark fetchers — FRED (yield series) + Yahoo (ETF closes).
// Both endpoints are free and unauthenticated, except FRED which needs a key.
//
// Each fetcher returns (today, prior) close pairs. We don't try to be clever
// about market-closed days — pickLatestPair walks back through the series and
// picks the two most recent non-null points.

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"

const TIMEOUT_MS = 4000

export type FetchedPair = {
  series_code: string
  source: "fred" | "yahoo"
  date_today: string // ISO date
  date_prior: string
  value_today: number
  value_prior: number
}

async function fetchWithTimeoutAndRetry(url: string, opts: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        ...opts,
        signal: ctl.signal,
        cache: "no-store",
        headers: {
          "User-Agent": "swarm-public/1.0 (daily-nav-marking)",
          ...(opts.headers ?? {}),
        },
      })
      clearTimeout(timer)
      if (res.ok) return res
      if (res.status >= 500 && attempt === 0) continue
      throw new Error(`HTTP ${res.status} on ${url}`)
    } catch (err) {
      clearTimeout(timer)
      if (attempt === 1) throw err
    }
  }
  throw new Error("unreachable")
}

function pickLatestPair<T extends { date: string; value: number | null }>(
  rows: T[],
): { today: T; prior: T } | null {
  const cleaned = rows.filter((r) => r.value !== null && Number.isFinite(r.value as number))
  if (cleaned.length < 2) return null
  // Caller is expected to pass rows in chronological order; we sort defensively.
  cleaned.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { today: cleaned[cleaned.length - 1], prior: cleaned[cleaned.length - 2] }
}

export async function fetchFred(series_id: string): Promise<FetchedPair> {
  const key = process.env.FRED_API_KEY
  if (!key) throw new Error("FRED_API_KEY not set")
  const url = `${FRED_BASE}?series_id=${encodeURIComponent(series_id)}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=10`
  const res = await fetchWithTimeoutAndRetry(url)
  const json = (await res.json()) as {
    observations?: Array<{ date: string; value: string }>
  }
  const obs = (json.observations ?? []).map((o) => ({
    date: o.date,
    value: o.value === "." ? null : Number(o.value),
  }))
  const pair = pickLatestPair(obs)
  if (!pair) throw new Error(`FRED ${series_id}: not enough observations`)
  return {
    series_code: series_id,
    source: "fred",
    date_today: pair.today.date,
    date_prior: pair.prior.date,
    value_today: pair.today.value as number,
    value_prior: pair.prior.value as number,
  }
}

export async function fetchYahoo(symbol: string): Promise<FetchedPair> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=10d`
  const res = await fetchWithTimeoutAndRetry(url)
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[]
        indicators?: { quote?: Array<{ close?: (number | null)[] }> }
      }>
    }
  }
  const node = json.chart?.result?.[0]
  const ts = node?.timestamp ?? []
  const closes = node?.indicators?.quote?.[0]?.close ?? []
  const rows: Array<{ date: string; value: number | null }> = ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    value: closes[i] ?? null,
  }))
  const pair = pickLatestPair(rows)
  if (!pair) throw new Error(`Yahoo ${symbol}: not enough closes`)
  return {
    series_code: symbol,
    source: "yahoo",
    date_today: pair.today.date,
    date_prior: pair.prior.date,
    value_today: pair.today.value as number,
    value_prior: pair.prior.value as number,
  }
}

// Resolve a benchmark code to the right fetcher. FRED series codes use
// alphanumerics and underscores; ETF tickers are uppercase letters only.
// Convention: if a code starts with a digit or contains an underscore /
// non-alpha character, treat as FRED. Otherwise Yahoo.
export function isFredSeries(code: string): boolean {
  // FRED OAS series we use: BAMLH0A0HYM2, BAMLC0A0CM. Treasury: DGS10, DGS3MO.
  return /[0-9_]/.test(code) || code.startsWith("DGS") || code.startsWith("BAML")
}

export async function fetchOne(code: string): Promise<FetchedPair> {
  return isFredSeries(code) ? fetchFred(code) : fetchYahoo(code)
}

export async function fetchAll(codes: string[]): Promise<{
  ok: FetchedPair[]
  errors: Array<{ code: string; error: string }>
}> {
  const settled = await Promise.allSettled(codes.map((c) => fetchOne(c)))
  const ok: FetchedPair[] = []
  const errors: Array<{ code: string; error: string }> = []
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(r.value)
    else errors.push({ code: codes[i], error: r.reason?.message ?? String(r.reason) })
  })
  return { ok, errors }
}
