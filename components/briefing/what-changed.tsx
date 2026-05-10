import Link from "next/link"
import type { ChangedCard } from "@/lib/briefing/derive"

const bucketStyle: Record<ChangedCard["bucket"], { border: string; dot: string; label: string }> = {
  critical: {
    border: "border-t-brick-red",
    dot: "text-brick-red",
    label: "critical",
  },
  watch: {
    border: "border-t-mustard",
    dot: "text-mustard",
    label: "watch",
  },
  info: {
    border: "border-t-terracotta",
    dot: "text-terracotta",
    label: "info",
  },
}

export function WhatChangedGrid({ cards }: { cards: ChangedCard[] }) {
  return (
    <section aria-label="What changed">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => {
          const s = bucketStyle[card.bucket]
          const isEmpty = card.hitId.startsWith("empty-")
          return (
            <article
              key={card.hitId}
              className={`flex flex-col rounded-b-lg border border-default bg-card p-5 border-t-[2px] ${s.border}`}
            >
              <div
                className={`mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] ${s.dot}`}
              >
                <span aria-hidden>●</span>
                <span>
                  {s.label}
                  {card.fund && card.fund !== "—" ? (
                    <>
                      {" · "}
                      <span className="font-medium text-gs-gold">{card.fund}</span>
                    </>
                  ) : null}
                </span>
              </div>
              <h3 className="mb-2 text-sm font-medium leading-snug text-default">
                {card.headline}
              </h3>
              <p className="mb-3 font-serif text-[13px] leading-relaxed text-muted">
                {card.body}
              </p>
              <div className="mt-auto flex items-center justify-between border-t border-default pt-3 font-mono text-[10.5px] text-dim">
                <span>{card.metaLeft}</span>
                {!isEmpty ? (
                  <Link
                    href={`/alerts/${card.hitId}`}
                    className="text-terracotta hover:underline"
                  >
                    open alert →
                  </Link>
                ) : (
                  <span className="text-dim">—</span>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
