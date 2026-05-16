import type {
  BorrowerDailySeries,
  BorrowerEventPin,
  BorrowerMarkSeries,
} from "@/lib/borrower/queries"

function quarterLabel(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${q}Q ’${yy}`
}

// Peer-line colors (cycled in order). Goldman gold is reserved for GSCR/GSBD.
const PEER_COLORS = ["#7a8aa3", "#5e7a86", "#876a8a", "#7a6f5e", "#5e7a86"]

const GS_COLOR = "#8a6f1d" // var(--gs)
const ACCENT = "#bd5d3c" // var(--accent), editorial only — used for the spread annotation

export function MarkChart({
  series,
  events,
  borrowerName,
  dailySeries,
}: {
  series: BorrowerMarkSeries[]
  events: BorrowerEventPin[]
  borrowerName: string
  dailySeries?: BorrowerDailySeries[]
}) {
  // Collect the union of periods.
  const periodSet = new Set<string>()
  for (const s of series) for (const p of s.points) periodSet.add(p.period_end)
  const periods = Array.from(periodSet).sort()

  if (series.length === 0 || periods.length === 0) {
    return (
      <div
        className="rounded-[10px] border px-6 py-8 text-center"
        style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          no mark history
        </div>
        <p className="mt-2 font-serif italic text-text-dim">
          No live observations for {borrowerName} since 2024-03-31.
        </p>
      </div>
    )
  }

  // Compute y range across all points.
  const marks: number[] = []
  for (const s of series) for (const p of s.points) if (p.mark_pct !== null) marks.push(p.mark_pct)
  if (marks.length === 0) {
    return (
      <div
        className="rounded-[10px] border px-6 py-8 text-center"
        style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          no marks
        </div>
        <p className="mt-2 font-serif italic text-text-dim">
          Observations are present but cost is missing — mark % cannot be computed.
        </p>
      </div>
    )
  }
  const yMinRaw = Math.min(...marks)
  const yMaxRaw = Math.max(...marks)
  // Pad y range slightly; round to whole percentage points for readable ticks.
  const yPad = Math.max(0.5, (yMaxRaw - yMinRaw) * 0.25)
  const yMin = Math.floor(yMinRaw - yPad)
  const yMax = Math.ceil(yMaxRaw + yPad)

  // Layout.
  const W = 640
  const H = 300
  const PAD_L = 50
  const PAD_R = 60 // legend gutter
  const PAD_T = 24
  const PAD_B = 56
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const periodIndex = new Map(periods.map((p, i) => [p, i]))
  const xFor = (i: number): number => {
    if (periods.length === 1) return PAD_L + plotW / 2
    return PAD_L + (i / (periods.length - 1)) * plotW
  }
  const yFor = (mark: number): number => {
    if (yMax === yMin) return PAD_T + plotH / 2
    return PAD_T + plotH - ((mark - yMin) / (yMax - yMin)) * plotH
  }

  // Build y ticks.
  const tickCount = 4
  const yTicks: number[] = []
  for (let i = 0; i <= tickCount; i++) {
    yTicks.push(yMin + ((yMax - yMin) * i) / tickCount)
  }

  // Build series colors.
  type SeriesViz = {
    s: BorrowerMarkSeries
    color: string
    accent: boolean
  }
  const viz: SeriesViz[] = []
  let peerIdx = 0
  for (const s of series) {
    if (s.is_goldman) {
      viz.push({ s, color: GS_COLOR, accent: true })
    } else {
      viz.push({ s, color: PEER_COLORS[peerIdx % PEER_COLORS.length], accent: false })
      peerIdx += 1
    }
  }

  // Event pins on the x axis (top of chart). Map event date to nearest period index.
  type EventViz = {
    e: BorrowerEventPin
    xPos: number
  }
  const eventViz: EventViz[] = []
  if (events.length > 0 && periods.length > 1) {
    const firstMs = new Date(periods[0]).getTime()
    const lastMs = new Date(periods[periods.length - 1]).getTime()
    for (const e of events) {
      const t = new Date(e.date).getTime()
      if (!Number.isFinite(t)) continue
      if (t < firstMs || t > lastMs + 1000 * 60 * 60 * 24 * 95) continue
      const frac =
        lastMs === firstMs ? 0.5 : Math.max(0, Math.min(1, (t - firstMs) / (lastMs - firstMs)))
      eventViz.push({ e, xPos: PAD_L + frac * plotW })
    }
  }

  function pinGlyph(kind: "litigation" | "management" | "news"): string {
    if (kind === "litigation") return "⚖"
    if (kind === "management") return "⌥"
    return "★"
  }
  function pinColor(kind: "litigation" | "management" | "news"): string {
    if (kind === "litigation") return "#a8412a" // red
    if (kind === "management") return "#a8841f" // amber
    return "#bd5d3c" // accent — editorial signal for news
  }

  // The spread annotation at the right edge — if spread >= 0.5pp at the latest period.
  const lastIdx = periods.length - 1
  const latestPeriod = periods[lastIdx]
  const latestMarks: number[] = []
  for (const v of viz) {
    const p = v.s.points.find((x) => x.period_end === latestPeriod)
    if (p && p.mark_pct !== null) latestMarks.push(p.mark_pct)
  }
  const spread =
    latestMarks.length >= 2 ? Math.max(...latestMarks) - Math.min(...latestMarks) : null

  return (
    <div
      className="rounded-[10px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <div className="border-b px-5 py-3" style={{ borderColor: "var(--line)" }}>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
          cross-fund mark history
        </div>
        <div className="mt-1 font-serif text-[16px] leading-[1.3] text-text">
          Mark % of cost · {periods.length} quarter{periods.length === 1 ? "" : "s"} · {viz.length}{" "}
          fund{viz.length === 1 ? "" : "s"}
        </div>
        <p className="mt-1 max-w-[640px] font-serif text-[13px] italic leading-[1.55] text-text-dim">
          Each line is one BDC. Goldman funds in gold; peers muted. Where lines diverge, mark
          variance reveals different credit views on the same security. Event pins above the axis
          mark non-filing signals on the same time axis.
        </p>
      </div>
      <div className="px-3 pb-4 pt-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          role="img"
          aria-label={`${borrowerName} cross-fund mark history`}
        >
          <title>{`${borrowerName} cross-fund mark history`}</title>
          <desc>
            {`${viz.length} fund mark series across ${periods.length} quarters from ${periods[0]} to ${periods[lastIdx]}.`}
          </desc>

          {/* Y-axis */}
          <line
            x1={PAD_L}
            y1={PAD_T}
            x2={PAD_L}
            y2={PAD_T + plotH}
            stroke="var(--line)"
            strokeWidth={0.6}
          />
          {/* X-axis */}
          <line
            x1={PAD_L}
            y1={PAD_T + plotH}
            x2={PAD_L + plotW}
            y2={PAD_T + plotH}
            stroke="var(--line)"
            strokeWidth={0.6}
          />

          {/* Y gridlines + tick labels */}
          {yTicks.map((t) => (
            <g key={`y-${t}`}>
              <line
                x1={PAD_L}
                y1={yFor(t)}
                x2={PAD_L + plotW}
                y2={yFor(t)}
                stroke="var(--bg-3)"
                strokeWidth={0.5}
                strokeDasharray="2,3"
              />
              <text
                x={PAD_L - 6}
                y={yFor(t) + 3}
                textAnchor="end"
                fontFamily="var(--font-mono)"
                fontSize={9}
                fill="var(--text-faint)"
              >
                {t.toFixed(0)}%
              </text>
            </g>
          ))}

          {/* X tick labels */}
          {periods.map((p, i) => (
            <text
              key={`x-${p}`}
              x={xFor(i)}
              y={PAD_T + plotH + 16}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={9}
              fill={i === lastIdx ? "var(--gs)" : "var(--text-faint)"}
              fontWeight={i === lastIdx ? 600 : 400}
            >
              {quarterLabel(p)}
            </text>
          ))}

          {/* Series lines: peers first (so Goldman renders on top) */}
          {viz
            .slice()
            .sort((a, b) => (a.accent === b.accent ? 0 : a.accent ? 1 : -1))
            .map((v) => {
              const pts = v.s.points
                .filter((p) => p.mark_pct !== null && periodIndex.has(p.period_end))
                .sort((a, b) => a.period_end.localeCompare(b.period_end))
              if (pts.length === 0) return null
              const d = pts
                .map((p, idx) => {
                  const x = xFor(periodIndex.get(p.period_end)!)
                  const y = yFor(p.mark_pct as number)
                  return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`
                })
                .join(" ")
              return (
                <g key={`line-${v.s.fund_ticker}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={v.color}
                    strokeWidth={v.accent ? 2.2 : 1.5}
                    strokeOpacity={v.accent ? 1 : 0.7}
                  />
                  {pts.map((p) => (
                    <circle
                      key={`pt-${v.s.fund_ticker}-${p.period_end}`}
                      cx={xFor(periodIndex.get(p.period_end)!)}
                      cy={yFor(p.mark_pct as number)}
                      r={v.accent ? 3 : 2.4}
                      fill={v.color}
                      fillOpacity={v.accent ? 1 : 0.85}
                    />
                  ))}
                  {/* Right-edge label */}
                  {(() => {
                    const last = pts[pts.length - 1]
                    return (
                      <text
                        x={xFor(periodIndex.get(last.period_end)!) + 6}
                        y={yFor(last.mark_pct as number) + 3}
                        fontFamily="var(--font-mono)"
                        fontSize={9.5}
                        fontWeight={v.accent ? 600 : 400}
                        fill={v.color}
                      >
                        {v.s.fund_ticker}
                        {v.accent ? " ★" : ""}
                      </text>
                    )
                  })()}
                </g>
              )
            })}

          {/* Spread annotation at the right edge */}
          {spread !== null && spread >= 0.5 && (
            <g>
              <line
                x1={xFor(lastIdx)}
                y1={PAD_T}
                x2={xFor(lastIdx)}
                y2={PAD_T + plotH}
                stroke={ACCENT}
                strokeWidth={0.5}
                strokeDasharray="3,3"
                strokeOpacity={0.5}
              />
              <text
                x={xFor(lastIdx)}
                y={PAD_T - 6}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize={9}
                fill={ACCENT}
              >
                spread {spread.toFixed(1)}pp
              </text>
            </g>
          )}

          {/* Event pins on the top edge */}
          {eventViz.map((ev, i) => (
            <g key={`ev-${i}`}>
              <line
                x1={ev.xPos}
                y1={PAD_T}
                x2={ev.xPos}
                y2={PAD_T + plotH}
                stroke={pinColor(ev.e.kind)}
                strokeWidth={0.5}
                strokeOpacity={0.18}
                strokeDasharray="2,3"
              />
              <text
                x={ev.xPos}
                y={PAD_T - 6}
                textAnchor="middle"
                fontSize={13}
                fill={pinColor(ev.e.kind)}
              >
                <title>{`${ev.e.kind} · ${ev.e.date} · ${ev.e.title}`}</title>
                {pinGlyph(ev.e.kind)}
              </text>
            </g>
          ))}
        </svg>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 px-2 font-mono text-[10.5px] text-text-dim">
          {viz.map((v) => (
            <span key={`leg-${v.s.fund_ticker}`} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-3 rounded-full"
                style={{ background: v.color, opacity: v.accent ? 1 : 0.7 }}
              />
              <span style={{ color: v.accent ? "var(--gs)" : "var(--text-dim)", fontWeight: v.accent ? 600 : 400 }}>
                {v.s.fund_ticker}
                {v.accent ? " ★" : ""}
              </span>
            </span>
          ))}
          <span className="ml-auto inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span style={{ color: pinColor("litigation") }}>⚖</span> litigation
            </span>
            <span className="inline-flex items-center gap-1">
              <span style={{ color: pinColor("management") }}>⌥</span> management
            </span>
            <span className="inline-flex items-center gap-1">
              <span style={{ color: pinColor("news") }}>★</span> news
            </span>
          </span>
        </div>

        {dailySeries && dailySeries.length > 0 ? (
          <DailyTail series={dailySeries} />
        ) : null}
      </div>
    </div>
  )
}

// 30-day daily mark tail. Renders one sparkline per Goldman fund holding this
// borrower. Shows mark trajectory between quarterly reports — decision-support
// only, never a replacement for the period-end fair value above.
function DailyTail({ series }: { series: BorrowerDailySeries[] }) {
  const W = 180
  const H = 40
  return (
    <div
      className="mt-4 border-t pt-3"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3 px-2">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
            daily NAV tail · last 30 days
          </div>
          <div className="mt-0.5 font-serif text-[12.5px] italic text-text-dim">
            Modeled daily marks between filings. Decision-support, not a 40-Act mark.
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 px-2">
        {series.map((s) => {
          const pts = s.points.filter(
            (p) => p.mark_pct !== null && Number.isFinite(p.mark_pct),
          )
          if (pts.length === 0) return null
          const marks = pts.map((p) => p.mark_pct as number)
          const yMin = Math.min(...marks)
          const yMax = Math.max(...marks)
          const yPad = Math.max(0.3, (yMax - yMin) * 0.25)
          const yLo = yMin - yPad
          const yHi = yMax + yPad
          const xFor = (i: number) =>
            pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W
          const yFor = (m: number) =>
            yHi === yLo ? H / 2 : H - ((m - yLo) / (yHi - yLo)) * H
          const d = pts
            .map((p, i) => {
              const x = xFor(i)
              const y = yFor(p.mark_pct as number)
              return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`
            })
            .join(" ")
          const last = pts[pts.length - 1]
          const stroke = s.is_goldman ? "var(--gs)" : "var(--text-faint)"
          const reviewFlag = pts.some((p) => p.requires_review)
          return (
            <div
              key={`tail-${s.fund_ticker}`}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
              style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
            >
              <svg
                viewBox={`0 0 ${W} ${H}`}
                width={W}
                height={H}
                role="img"
                aria-label={`${s.fund_ticker} 30-day daily mark trail`}
              >
                <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} />
                <circle
                  cx={xFor(pts.length - 1)}
                  cy={yFor(last.mark_pct as number)}
                  r={2.5}
                  fill={stroke}
                />
              </svg>
              <div className="font-mono text-[11px] leading-tight">
                <div
                  className={s.is_goldman ? "" : "text-text-dim"}
                  style={s.is_goldman ? { color: "var(--gs)", fontWeight: 600 } : undefined}
                >
                  {s.fund_ticker}
                  {s.is_goldman ? " ★" : ""}
                </div>
                <div className="mt-0.5 tabular-nums text-text">
                  {(last.mark_pct as number).toFixed(1)}
                  {reviewFlag ? (
                    <span className="ml-1" style={{ color: "var(--amber)" }} title="flagged for review">
                      ⚑
                    </span>
                  ) : null}
                </div>
                {last.delta_bps !== null && Number.isFinite(last.delta_bps) ? (
                  <div
                    className="text-[10.5px] tabular-nums"
                    style={{
                      color:
                        (last.delta_bps as number) <= -100
                          ? "var(--red)"
                          : (last.delta_bps as number) <= -25
                            ? "var(--amber)"
                            : (last.delta_bps as number) >= 25
                              ? "var(--green)"
                              : "var(--text-dim)",
                    }}
                  >
                    {(last.delta_bps as number) > 0 ? "+" : (last.delta_bps as number) < 0 ? "−" : ""}
                    {Math.abs(last.delta_bps as number).toFixed(0)} bps today
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
