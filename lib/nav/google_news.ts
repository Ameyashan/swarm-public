// Google News RSS client. Free, no key. Coverage of private LBO borrowers
// is materially better than GDELT for the kind of trade-press headlines
// that move credit (covenant amendments, lender-letter coverage, distress
// reporting). Same NewsItem shape as the GDELT client so news-scan can mix
// the two feeds and dedupe via news_items (source, source_id).

const GNEWS_RSS = "https://news.google.com/rss/search"
const MIN_INTERVAL_MS = 350 // a bit slower than GDELT — Google is less tolerant
let lastAt = 0

async function throttle() {
  const elapsed = Date.now() - lastAt
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed))
  }
  lastAt = Date.now()
}

export type GoogleNewsArticle = {
  url: string
  title: string
  published_at: string // ISO
  source_name?: string
}

// Google News titles arrive as "Headline text - Publisher Name". Strip the
// trailing publisher segment so it doesn't pollute the scored body.
function splitTitle(raw: string): { title: string; source_name?: string } {
  const m = raw.match(/^(.*?)\s+-\s+([^-]+)$/)
  if (m) return { title: m[1].trim(), source_name: m[2].trim() }
  return { title: raw.trim() }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

// Tiny RSS item parser. The Google News feed is well-formed and predictable;
// pulling in a full XML parser isn't worth the dep for this shape.
function parseItems(xml: string): GoogleNewsArticle[] {
  const out: GoogleNewsArticle[] = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1]
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ""
    const pub = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ""
    if (!title || !link) continue
    const cleanTitle = decodeEntities(title.replace(/<!\[CDATA\[|\]\]>/g, ""))
    const { title: t, source_name } = splitTitle(cleanTitle)
    out.push({
      url: link.trim(),
      title: t,
      source_name,
      published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
    })
  }
  return out
}

// `when` accepts Google operators like "1d" (last day), "7d", or "1h".
export async function searchGoogleNews(
  term: string,
  when = "1d",
  maxRecords = 15,
): Promise<GoogleNewsArticle[]> {
  if (!term || term.length < 3) return []
  await throttle()
  const query = encodeURIComponent(`"${term}" when:${when}`)
  const url = `${GNEWS_RSS}?q=${query}&hl=en-US&gl=US&ceid=US:en`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": process.env.GOOGLE_NEWS_USER_AGENT ?? "swarm-public/1.0 (news-scan)",
      },
      signal: ac.signal,
    })
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) return []
  const xml = await res.text()
  return parseItems(xml).slice(0, maxRecords)
}
