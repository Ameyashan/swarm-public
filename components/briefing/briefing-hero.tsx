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
    <header className="mb-8 flex flex-col gap-4 border-b border-default pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-dim">
          {stamp}
        </div>
        <h1 className="font-serif text-4xl font-normal leading-[1.1] tracking-tight text-default sm:text-[42px]">
          Good morning, <span className="text-gs-gold">Ameya</span>.
        </h1>
        <p className="mt-3 max-w-2xl font-serif text-[17px] leading-relaxed text-muted">
          Here's what changed in GSCR and GSBD overnight, what to bring to the 9 AM committee,
          and how Goldman's marks compare to the BDC universe this week.
        </p>
      </div>
      <ul className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted">
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brick-red" aria-hidden />
          <span>
            <span className="font-medium text-default">{critical}</span> critical
          </span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-mustard" aria-hidden />
          <span>
            <span className="font-medium text-default">{watch}</span> watch
          </span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-sage" aria-hidden />
          <span>
            <span className="font-medium text-default">{info}</span> info
          </span>
        </li>
      </ul>
    </header>
  )
}
