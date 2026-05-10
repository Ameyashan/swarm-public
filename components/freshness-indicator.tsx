import { createClient } from "@/lib/supabase/server"

const FRESH_HOURS = 36

/**
 * Server component: queries MAX(ingested_at) on every page load (the layout
 * is dynamic) and renders a small Live/Stale pill with a pulsing dot.
 *
 * Tooltip is delivered with the native `title` attr on a wrapping div, plus
 * a CSS-only hover tooltip. We keep it simple to avoid pulling in a portal.
 */
export async function FreshnessIndicator() {
  const supabase = createClient()

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString()

  const [latestRes, weekRes] = await Promise.all([
    supabase
      .from("filings")
      .select("ingested_at")
      .order("ingested_at", { ascending: false })
      .limit(1),
    supabase
      .from("filings")
      .select("id", { count: "exact", head: true })
      .gte("ingested_at", sevenDaysAgo),
  ])

  const latest = latestRes.data?.[0]?.ingested_at as string | undefined
  const filingsLast7d = weekRes.count ?? 0

  if (!latest) {
    return null
  }

  const latestDate = new Date(latest)
  const ageMs = Date.now() - latestDate.getTime()
  const ageHours = ageMs / (1000 * 60 * 60)
  const isFresh = ageHours <= FRESH_HOURS

  const ageLabel = formatAge(ageMs)

  // Render an absolutely-positioned tooltip on hover via Tailwind group utils.
  return (
    <div className="relative group">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums ${
          isFresh
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
        }`}
        aria-label={isFresh ? "Data is live" : "Data is stale"}
      >
        <span
          className={`freshness-dot ${isFresh ? "" : "freshness-dot--stale"}`}
          aria-hidden
        />
        {isFresh ? "Live" : "Stale"}
        <span className="hidden sm:inline text-[10px] opacity-70">
          · {ageLabel}
        </span>
      </div>
      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-40 mt-2 w-60 rounded-md border border-border bg-[#0F1623]/95 p-3 text-[11px] leading-relaxed text-foreground/90 opacity-0 shadow-xl backdrop-blur transition-opacity duration-150 group-hover:opacity-100"
      >
        <div className="font-semibold text-foreground">
          {isFresh ? "Data is live" : "Data may be stale"}
        </div>
        <div className="mt-1 text-muted-foreground">
          Last filing ingested:
        </div>
        <div className="font-mono text-[11px] text-foreground">
          {latestDate.toUTCString().replace(" GMT", " UTC")}
        </div>
        <div className="mt-2 text-muted-foreground">
          Filings in last 7 days:{" "}
          <span className="font-mono text-foreground">
            {filingsLast7d.toLocaleString("en-US")}
          </span>
        </div>
      </div>
    </div>
  )
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
