import "server-only"

// Bulk historical pulls for FRED + Yahoo, used by the Phase 4 backtest.
// Same endpoints as `fetchers.ts` but return long time series.
//
// FRED: observations endpoint with date bounds + larger limit.
// Yahoo: chart endpoint with range=2y / interval=1d.

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
const TIMEOUT_MS = 10_000

export type HistoricalPoint = {
  series_code: string
  source: "fred" | "yahoo"
  as_of_date: string // YYYY-MM-DD
  value: number
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { "User-Agent": "swarm-public/1.0 (backtest)" },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchFredHistory(
  series_id: string,
  start: string,
  end: string,
): Promise<HistoricalPoint[]> {
  const key = process.env.FRED_API_KEY
  if (!key) throw new Error("FRED_API_KEY not set")
  const url =
    `${FRED_BASE}?series_id=${encodeURIComponent(series_id)}` +
    `&api_key=${encodeURIComponent(key)}&file_type=json` +
    `&observation_start=${start}&observation_end=${end}` +
    `&sort_order=asc&limit=100000`
  const res = await fetchWithTimeout(url)
  const json = (await res.json()) as {
    observations?: Array<{ date: string; value: string }>
  }
  const out: HistoricalPoint[] = []
  for (const o of json.observations ?? []) {
    if (o.value === "." || o.value === "") continue
    const v = Number(o.value)
    if (!Number.isFinite(v)) continue
    out.push({ series_code: series_id, source: "fred", as_of_date: o.date, value: v })
  }
  return out
}

export async function fetchYahooHistory(
  symbol: string,
  range: "1y" | "2y" | "5y" = "2y",
): Promise<HistoricalPoint[]> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}`
  const res = await fetchWithTimeout(url)
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
  const out: HistoricalPoint[] = []
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i]
    if (v === null || v === undefined || !Number.isFinite(v)) continue
    const d = new Date(ts[i] * 1000).toISOString().slice(0, 10)
    out.push({ series_code: symbol, source: "yahoo", as_of_date: d, value: v as number })
  }
  return out
}

const FRED_SERIES = ["BAMLH0A0HYM2", "BAMLC0A0CM", "DGS10", "DGS3MO"]
const YAHOO_SERIES = [
  "BKLN", "BIZD", "HYG", "JNK", "ANGL",
  "XLK", "XLI", "XLE", "XLV", "XLY", "XLF", "XLP", "XLU", "XLB", "XLRE", "XLC",
]

// Pull every series we use for ~2 years and merge into a single list.
export async function fetchAllHistorical(
  start: string,
  end: string,
): Promise<{ ok: HistoricalPoint[]; errors: Array<{ code: string; error: string }> }> {
  const ok: HistoricalPoint[] = []
  const errors: Array<{ code: string; error: string }> = []
  const fredResults = await Promise.allSettled(
    FRED_SERIES.map((s) => fetchFredHistory(s, start, end)),
  )
  fredResults.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(...r.value)
    else errors.push({ code: FRED_SERIES[i], error: String(r.reason?.message ?? r.reason) })
  })
  const yahooResults = await Promise.allSettled(
    YAHOO_SERIES.map((s) => fetchYahooHistory(s, "2y")),
  )
  yahooResults.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ok.push(...r.value.filter((p) => p.as_of_date >= start && p.as_of_date <= end))
    } else {
      errors.push({ code: YAHOO_SERIES[i], error: String(r.reason?.message ?? r.reason) })
    }
  })
  return { ok, errors }
}
