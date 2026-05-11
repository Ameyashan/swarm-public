import type { FundPeerStats } from "@/lib/briefing/queries"

type RankRow = {
  label: string
  percentile: number
  tone: "ok" | "watch" | "critical"
  display: string
}

function pctRank(vals: number[], target: number): number {
  if (vals.length === 0) return 50
  let lt = 0
  let eq = 0
  for (const v of vals) {
    if (v < target) lt += 1
    else if (v === target) eq += 1
  }
  const p = (lt + 0.5 * eq) / vals.length
  return Math.max(0, Math.min(100, Math.round(p * 100)))
}

function toneFor(p: number): "ok" | "watch" | "critical" {
  if (p < 35) return "ok"
  if (p < 65) return "watch"
  return "critical"
}

function fmtPct(n: number, digits = 2) {
  return `${n.toFixed(digits)}%`
}

const TONE_FILL: Record<RankRow["tone"], string> = {
  ok: "var(--green)",       // sage — healthy / positive credit signal
  watch: "var(--amber)",    // mustard — watch
  critical: "var(--red)",   // brick — critical
}

export function PeerRankPanel({
  stats,
  markVariance,
}: {
  stats: FundPeerStats[]
  markVariance: {
    percentile: number
    label: string
  } | null
}) {
  const gscr = stats.find((s) => s.fund_ticker === "GSCR")
  if (!gscr) {
    return (
      <section
        aria-label="Peer rank"
        className="rounded-[10px] border px-5 py-[18px]"
        style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
      >
        <h2 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-dim">
          peer rank
        </h2>
        <p className="font-serif italic text-text-dim">
          GSCR observations not available in this snapshot.
        </p>
      </section>
    )
  }

  const piks = stats.map((s) => s.pik_pct ?? 0)
  const nas = stats.map((s) => s.na_pct ?? 0)
  const hits = stats.map((s) => s.hit_count_latest_q ?? 0)

  const rows: RankRow[] = []

  if (piks.every(Number.isFinite)) {
    const p = pctRank(piks, gscr.pik_pct ?? 0)
    rows.push({
      label: "PIK share",
      percentile: p,
      tone: toneFor(p),
      display: fmtPct(gscr.pik_pct ?? 0, 2),
    })
  }
  if (nas.every(Number.isFinite)) {
    const p = pctRank(nas, gscr.na_pct ?? 0)
    rows.push({
      label: "Non-accrual",
      percentile: p,
      tone: toneFor(p),
      display: fmtPct(gscr.na_pct ?? 0, 2),
    })
  }
  if (hits.length > 0) {
    const p = pctRank(hits, gscr.hit_count_latest_q ?? 0)
    rows.push({
      label: "Hit count",
      percentile: p,
      tone: toneFor(p),
      display: `${gscr.hit_count_latest_q ?? 0} / Q`,
    })
  }
  if (markVariance) {
    rows.push({
      label: "Mark variance",
      percentile: markVariance.percentile,
      tone: toneFor(markVariance.percentile),
      display: markVariance.label,
    })
  }

  return (
    <section
      aria-label="Peer rank"
      className="rounded-[10px] border px-5 py-[18px]"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-text">
        peer rank · GSCR vs {stats.length} BDCs
      </h2>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li
            key={r.label}
            className="grid grid-cols-[120px_1fr_72px] items-center gap-3"
          >
            <span className="font-mono text-[11px] text-text-dim">
              {r.label}
            </span>
            <div
              className="relative h-2 rounded-full"
              style={{ background: "var(--bg-3)" }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{
                  width: `${r.percentile}%`,
                  background: TONE_FILL[r.tone],
                }}
              />
              <div
                className="absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded-sm"
                style={{
                  left: `${r.percentile}%`,
                  background: "var(--gs)",
                  boxShadow: "0 0 4px rgba(138, 111, 29, 0.6)",
                }}
                aria-label={`GSCR percentile ${r.percentile}`}
              />
            </div>
            <span className="text-right font-mono text-[11px] text-text">
              {r.display}
            </span>
          </li>
        ))}
      </ul>
      <p
        className="mt-4 border-t pt-3 font-mono text-[10px] leading-[1.55] text-text-faint"
        style={{ borderColor: "var(--line)" }}
      >
        Gold pin = GSCR percentile across {stats.length} BDCs. Below 50 = better
        than peers. Above 50 = worse.
      </p>
    </section>
  )
}
