import { briefingTimestampET } from "@/lib/briefing/derive"

export function BriefingHero({
  critical,
  watch,
  info,
  now,
}: {
  critical: number
  watch: number
  info: number
  now?: Date
}) {
  const stamp = briefingTimestampET(now)
  return (
    <header
      className="mb-7 flex flex-col gap-4 border-b pb-[22px] sm:flex-row sm:items-end sm:justify-between"
      style={{ borderColor: "var(--line)" }}
    >
      <div>
        <div className="mb-[6px] font-mono text-[11px] text-text-faint">
          {stamp}
        </div>
        <h1 className="font-serif text-[34px] font-normal leading-[1.15] tracking-[-0.8px] text-text">
          Good morning, <span className="text-gs">Ameya</span>.
        </h1>
        <p className="mt-2 max-w-[720px] font-serif text-[17px] leading-[1.6] text-text-dim">
          Here&apos;s what changed in GSCR and GSBD overnight, what to bring to
          the 9 AM committee, and how Goldman&apos;s marks compare to the BDC
          universe this week.
        </p>
      </div>
      <ul className="flex flex-wrap items-center gap-[14px] font-mono text-[11px] text-text-dim">
        <li className="flex items-center gap-1.5">
          <span className="text-red" aria-hidden>
            ●
          </span>
          <span>
            <span className="font-medium text-text">{critical}</span> critical
          </span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-amber" aria-hidden>
            ●
          </span>
          <span>
            <span className="font-medium text-text">{watch}</span> watch
          </span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-green" aria-hidden>
            ●
          </span>
          <span>
            <span className="font-medium text-text">{info}</span> info
          </span>
        </li>
      </ul>
    </header>
  )
}
