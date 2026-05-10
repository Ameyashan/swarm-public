import { ImageResponse } from "next/og"

// Vercel ImageResponse — generates a dynamic 1200x630 PNG used for the site's
// Open Graph card. The PNG is regenerated whenever the home_summary RPC
// returns new numbers (revalidated every 5 min). Uses a direct REST fetch
// instead of the SSR client so it can run on the edge without cookie deps.
export const runtime = "edge"
export const alt = "Swarm Public — Agentic intelligence for public private credit"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export const revalidate = 300

async function fetchHomeSummary(): Promise<{
  hits: number
  totalFvB: number
}> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) return { hits: 0, totalFvB: 0 }
    const res = await fetch(`${url}/rest/v1/rpc/home_summary`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      next: { revalidate: 300 },
    })
    if (!res.ok) return { hits: 0, totalFvB: 0 }
    const data = (await res.json()) as Array<{
      total_fv_b?: number | string
      total_hits_90d?: number | string
    }>
    const summary = Array.isArray(data) ? data[0] : null
    return {
      hits: Number(summary?.total_hits_90d ?? 0),
      totalFvB: Number(summary?.total_fv_b ?? 0),
    }
  } catch {
    return { hits: 0, totalFvB: 0 }
  }
}

export default async function OG() {
  const { hits, totalFvB } = await fetchHomeSummary()

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "linear-gradient(135deg, #0F1623 0%, #0a0f1a 50%, #1a0f1a 100%)",
          padding: 80,
          color: "#E5E7EB",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top row — logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 9999,
              background: "#EF4444",
              boxShadow: "0 0 24px #EF4444",
            }}
          />
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: -0.5,
              color: "#F3F4F6",
            }}
          >
            Swarm Public
          </span>
        </div>

        {/* Middle — headline + numbers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              letterSpacing: -1.5,
              lineHeight: 1.05,
              color: "#F9FAFB",
              maxWidth: 980,
            }}
          >
            The agentic intelligence layer for public private credit
          </div>
          <div style={{ display: "flex", gap: 56 }}>
            <Stat
              value={`$${totalFvB.toFixed(1)}B`}
              label="Monitored"
              color="#3B82F6"
            />
            <Stat
              value={hits.toLocaleString("en-US")}
              label="Detector hits · last 90d"
              color="#EF4444"
            />
            <Stat value="3" label="Predictive detectors" color="#10B981" />
          </div>
        </div>

        {/* Bottom row — tagline */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#9CA3AF",
            fontSize: 22,
            fontFamily: "monospace",
          }}
        >
          <span>swarm-public.vercel.app</span>
          <span>Every alert cited</span>
        </div>
      </div>
    ),
    { ...size },
  )
}

function Stat({
  value,
  label,
  color,
}: {
  value: string
  label: string
  color: string
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          fontSize: 56,
          fontWeight: 700,
          color,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 18,
          color: "#9CA3AF",
          fontFamily: "monospace",
          textTransform: "uppercase",
          letterSpacing: 2,
        }}
      >
        {label}
      </div>
    </div>
  )
}
