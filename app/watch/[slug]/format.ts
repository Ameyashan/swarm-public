// Shared formatters for the /watch/[slug] page and its tab components.
// Lives in a leaf file so client components can import without dragging in
// server-only Supabase code.

export function fmtUsdFromThousands(t: number | null | undefined): string {
  if (t == null || Number.isNaN(t)) return "—"
  const m = t / 1000
  if (Math.abs(m) >= 1000) return `$${(m / 1000).toFixed(2)}B`
  if (Math.abs(m) >= 10) return `$${m.toFixed(1)}M`
  return `$${m.toFixed(2)}M`
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—"
  return `${(n * 100).toFixed(digits)}%`
}

export function fmtPeriodShort(s: string | null | undefined): string {
  if (!s) return "—"
  const d = new Date(s + "T00:00:00")
  if (Number.isNaN(d.getTime())) return s
  // e.g. "Q1 '26"
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `Q${q} '${yy}`
}
