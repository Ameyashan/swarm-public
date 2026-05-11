import Link from "next/link"
import type { ChangedCard } from "@/lib/briefing/derive"

// Strict palette mapping for the top-border colour encoding.
//   critical → brick red    (#a8412a)
//   watch    → mustard      (#a8841f)
//   info     → terracotta   (#bd5d3c)  ← editorial accent for the neutral bucket
const bucketStyle: Record<
  ChangedCard["bucket"],
  { borderTop: string; eyebrowColor: string; label: string }
> = {
  critical: {
    borderTop: "var(--red)",
    eyebrowColor: "var(--red)",
    label: "critical",
  },
  watch: {
    borderTop: "var(--amber)",
    eyebrowColor: "var(--amber)",
    label: "watch",
  },
  info: {
    borderTop: "var(--accent)",
    eyebrowColor: "var(--accent)",
    label: "info",
  },
}

export function WhatChangedGrid({ cards }: { cards: ChangedCard[] }) {
  return (
    <section aria-label="What changed">
      <div className="grid grid-cols-1 gap-[14px] md:grid-cols-3">
        {cards.map((card) => {
          const s = bucketStyle[card.bucket]
          const isEmpty = card.hitId.startsWith("empty-")
          return (
            <article
              key={card.hitId}
              className="flex flex-col rounded-b-[8px] border px-[18px] py-4"
              style={{
                background: "var(--bg-1)",
                borderColor: "var(--line)",
                borderTop: `2px solid ${s.borderTop}`,
              }}
            >
              <div
                className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                style={{ color: s.eyebrowColor }}
              >
                <span aria-hidden>●</span>
                <span>
                  {s.label}
                  {card.fund && card.fund !== "—" ? (
                    <>
                      {" · "}
                      <span className="font-medium text-gs">{card.fund}</span>
                    </>
                  ) : null}
                </span>
              </div>
              <h3 className="mb-2 text-[14px] font-medium leading-[1.4] text-text">
                {card.headline}
              </h3>
              <p className="mb-3 font-serif text-[13px] leading-[1.6] text-text-dim">
                {card.body}
              </p>
              <div
                className="mt-auto flex items-center justify-between border-t pt-[10px] font-mono text-[10.5px] text-text-faint"
                style={{ borderColor: "var(--line)" }}
              >
                <span>{card.metaLeft}</span>
                {!isEmpty && card.borrower ? (
                  <Link
                    href={`/borrower/${encodeURIComponent(card.borrower)}`}
                    className="text-accent hover:underline"
                  >
                    open x-ray →
                  </Link>
                ) : (
                  <span>—</span>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
