import type { PeerCohortFund } from "@/lib/peer/queries"

const GOLDMAN = new Set(["GSCR", "GSBD"])

export type PanelTone = "ok" | "watch" | "crit"

export type PeerBarRow = {
  ticker: string
  value: number | null
  display: string
  tone: PanelTone
  isGoldman: boolean
}

function fillColor(tone: PanelTone, isGoldman: boolean): string {
  if (isGoldman) return "var(--gs)"
  if (tone === "crit") return "var(--red)"
  if (tone === "watch") return "var(--amber)"
  return "var(--green)"
}

export function PeerCard({
  title,
  sub,
  rows,
  callout,
  emptyMessage,
}: {
  title: string
  sub: string
  rows: PeerBarRow[]
  callout: string
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded-[10px] border p-5"
        style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          {title}
        </div>
        <p className="mt-3 font-serif italic text-text-dim">
          {emptyMessage ?? "No peer data available for this metric."}
        </p>
      </div>
    )
  }

  // Bars sized relative to max absolute value so we work for signed metrics
  // (mark variance) too.
  const maxAbs = Math.max(
    ...rows.map((r) => (r.value !== null && Number.isFinite(r.value) ? Math.abs(r.value) : 0)),
    1e-9,
  )

  return (
    <section
      className="flex flex-col rounded-[10px] border p-5"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text">
        {title}
      </div>
      <p className="mb-4 mt-1 font-serif text-[12.5px] italic leading-[1.5] text-text-dim">
        {sub}
      </p>

      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const widthPct =
            r.value === null || !Number.isFinite(r.value)
              ? 0
              : Math.max(2, Math.round((Math.abs(r.value) / maxAbs) * 100))
          return (
            <li
              key={r.ticker}
              className="grid grid-cols-[80px_1fr_72px] items-center gap-3"
              style={{
                background: r.isGoldman ? "var(--gs-bg)" : "transparent",
                borderRadius: 4,
                padding: r.isGoldman ? "2px 4px" : "2px 0",
              }}
            >
              <span
                className="font-mono text-[11.5px]"
                style={{
                  color: r.isGoldman ? "var(--gs)" : "var(--text-dim)",
                  fontWeight: r.isGoldman ? 600 : 400,
                }}
              >
                {r.ticker}
                {r.isGoldman ? " ★" : ""}
              </span>
              <div
                className="relative h-[10px] rounded-full"
                style={{ background: "var(--bg-3)" }}
              >
                <div
                  className="absolute left-0 top-0 h-full rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    background: fillColor(r.tone, r.isGoldman),
                  }}
                />
              </div>
              <span
                className="text-right font-mono text-[11.5px] tabular-nums"
                style={{
                  color: r.isGoldman ? "var(--gs)" : "var(--text)",
                  fontWeight: r.isGoldman ? 600 : 400,
                }}
              >
                {r.display}
              </span>
            </li>
          )
        })}
      </ul>

      <p
        className="mt-4 border-t pt-3 font-serif text-[13px] italic leading-[1.55] text-text-dim"
        style={{ borderColor: "var(--line)" }}
      >
        {callout}
      </p>
    </section>
  )
}

export function isGoldman(ticker: string): boolean {
  return GOLDMAN.has(ticker)
}
