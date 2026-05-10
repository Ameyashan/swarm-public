import type { EditorialHeadline } from "@/lib/briefing/derive"

export function EditorialHeadlineBlock({
  headline,
}: {
  headline: EditorialHeadline
}) {
  return (
    <section
      aria-label="Today's headline"
      className="relative overflow-hidden rounded-r-xl border border-terracotta/40 border-l-[3px] border-l-terracotta bg-gradient-to-b from-terracotta-soft via-transparent to-transparent p-6 sm:p-7"
    >
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-terracotta">
        Today's headline · auto-generated
      </div>
      <p className="font-serif text-2xl leading-[1.4] tracking-tight text-default sm:text-[26px]">
        {headline.spans.map((span, i) => {
          if (span.kind === "ticker") {
            return (
              <span
                key={i}
                className="font-mono not-italic font-medium text-gs-gold"
              >
                {span.text}
              </span>
            )
          }
          if (span.kind === "company") {
            const color =
              span.severity === "critical"
                ? "text-brick-red"
                : span.severity === "watch"
                ? "text-mustard"
                : "text-default"
            return (
              <span key={i} className={`not-italic font-medium ${color}`}>
                {span.text}
              </span>
            )
          }
          return <span key={i}>{span.text}</span>
        })}
      </p>
      <div className="mt-3 font-mono text-[11px] text-dim">{headline.meta}</div>
    </section>
  )
}
