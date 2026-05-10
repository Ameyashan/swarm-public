import type { EditorialHeadline } from "@/lib/briefing/derive"

export function EditorialHeadlineBlock({
  headline,
}: {
  headline: EditorialHeadline
}) {
  return (
    <section
      aria-label="Today's headline"
      className="rounded-r-[10px] border border-l-[3px] px-[26px] py-[22px]"
      style={{
        borderColor: "var(--accent)",
        background:
          "linear-gradient(180deg, rgba(189, 93, 60, 0.06), transparent 70%)",
      }}
    >
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
        Today&apos;s headline · auto-generated
      </div>
      <p className="font-serif text-[24px] font-normal leading-[1.4] tracking-[-0.4px] text-text">
        {headline.spans.map((span, i) => {
          if (span.kind === "ticker") {
            return (
              <span
                key={i}
                className="font-mono font-medium not-italic text-gs"
              >
                {span.text}
              </span>
            )
          }
          if (span.kind === "company") {
            const color =
              span.severity === "critical"
                ? "text-red"
                : span.severity === "watch"
                ? "text-amber"
                : "text-text"
            return (
              <span key={i} className={`font-medium not-italic ${color}`}>
                {span.text}
              </span>
            )
          }
          return <span key={i}>{span.text}</span>
        })}
      </p>
      <div className="mt-3 font-mono text-[11px] text-text-faint">
        {headline.meta}
      </div>
    </section>
  )
}
