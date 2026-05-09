import type { FvPoint } from "@/lib/case-studies"

type Props = {
  data: FvPoint[]
  width?: number
  height?: number
}

// Minimal inline-SVG line chart for fair-value trajectory. Server-renderable
// (no client JS), responsive via viewBox. Marks "detector fired" periods with
// a colored ring + dashed vertical guide.
export function FvTrajectoryChart({ data, width = 640, height = 220 }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No trajectory data.</div>
    )
  }

  const padL = 56 // y-axis labels
  const padR = 16
  const padT = 16
  const padB = 36 // x-axis labels

  const innerW = width - padL - padR
  const innerH = height - padT - padB

  const values = data.map((d) => d.fv_thousands).filter((v): v is number => v != null)
  const yMin = Math.min(0, ...values)
  const yMaxRaw = Math.max(...values, 1)
  const yMax = yMaxRaw * 1.08 // headroom

  function xAt(i: number) {
    if (data.length === 1) return padL + innerW / 2
    return padL + (i / (data.length - 1)) * innerW
  }
  function yAt(v: number) {
    if (yMax === yMin) return padT + innerH / 2
    return padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH
  }

  // Build poly-line path, breaking on null so gaps don't connect.
  let pathD = ""
  let inSegment = false
  data.forEach((d, i) => {
    if (d.fv_thousands == null) {
      inSegment = false
      return
    }
    const cmd = inSegment ? "L" : "M"
    pathD += `${cmd}${xAt(i).toFixed(1)},${yAt(d.fv_thousands).toFixed(1)} `
    inSegment = true
  })

  // Axis ticks: a few horizontal gridlines at nice round numbers.
  const ticks = niceTicks(yMin, yMax, 4)

  // X-axis labels: show every 1 if <=8 points, else thin out.
  const labelEvery = data.length <= 8 ? 1 : Math.ceil(data.length / 8)

  function fmtUsd(thousands: number): string {
    const m = thousands / 1000
    if (Math.abs(m) >= 1000) return `$${(m / 1000).toFixed(1)}B`
    if (Math.abs(m) >= 10) return `$${m.toFixed(0)}M`
    return `$${m.toFixed(1)}M`
  }
  function fmtPeriod(s: string): string {
    // 2024-09-30 -> Q3 '24
    const m = /^(\d{4})-(\d{2})/.exec(s)
    if (!m) return s
    const yr = m[1].slice(2)
    const mo = parseInt(m[2], 10)
    const q = mo <= 3 ? "Q1" : mo <= 6 ? "Q2" : mo <= 9 ? "Q3" : "Q4"
    return `${q} '${yr}`
  }

  return (
    <svg
      role="img"
      aria-label="Fair value trajectory"
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
    >
      {/* gridlines + y-axis labels */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={width - padR}
            y1={yAt(t)}
            y2={yAt(t)}
            stroke="currentColor"
            strokeOpacity={0.12}
          />
          <text
            x={padL - 6}
            y={yAt(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill="currentColor"
            opacity={0.6}
          >
            {fmtUsd(t)}
          </text>
        </g>
      ))}

      {/* detector-fired vertical guides */}
      {data.map((d, i) =>
        d.detector_fired ? (
          <line
            key={`g-${i}`}
            x1={xAt(i)}
            x2={xAt(i)}
            y1={padT}
            y2={height - padB}
            stroke="hsl(0 84% 60%)"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.55}
          />
        ) : null,
      )}

      {/* main FV line */}
      <path
        d={pathD.trim()}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      />

      {/* points */}
      {data.map((d, i) => {
        if (d.fv_thousands == null) return null
        const fired = d.detector_fired
        return (
          <g key={`p-${i}`}>
            <circle
              cx={xAt(i)}
              cy={yAt(d.fv_thousands)}
              r={fired ? 5 : 3}
              fill={fired ? "hsl(0 84% 60%)" : "currentColor"}
              stroke={fired ? "hsl(0 84% 60%)" : "none"}
            />
            {fired ? (
              <circle
                cx={xAt(i)}
                cy={yAt(d.fv_thousands)}
                r={9}
                fill="none"
                stroke="hsl(0 84% 60%)"
                strokeOpacity={0.4}
                strokeWidth={1.5}
              />
            ) : null}
          </g>
        )
      })}

      {/* x-axis labels */}
      {data.map((d, i) =>
        i % labelEvery === 0 || i === data.length - 1 ? (
          <text
            key={`x-${i}`}
            x={xAt(i)}
            y={height - padB + 18}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            opacity={0.6}
          >
            {fmtPeriod(d.period_end)}
          </text>
        ) : null,
      )}
    </svg>
  )
}

function niceTicks(min: number, max: number, target: number): number[] {
  if (max <= min) return [min]
  const range = max - min
  const step = niceNum(range / target, true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = niceMin; v <= niceMax + 0.5 * step; v += step) {
    out.push(v)
  }
  return out
}
function niceNum(x: number, round: boolean): number {
  const exp = Math.floor(Math.log10(Math.max(1, x)))
  const f = x / Math.pow(10, exp)
  let nf: number
  if (round) {
    if (f < 1.5) nf = 1
    else if (f < 3) nf = 2
    else if (f < 7) nf = 5
    else nf = 10
  } else {
    if (f <= 1) nf = 1
    else if (f <= 2) nf = 2
    else if (f <= 5) nf = 5
    else nf = 10
  }
  return nf * Math.pow(10, exp)
}
