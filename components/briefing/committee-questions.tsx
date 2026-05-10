import type { CommitteeQuestion } from "@/lib/briefing/derive"

export function CommitteeQuestions({ questions }: { questions: CommitteeQuestion[] }) {
  return (
    <section
      aria-label="Committee questions"
      className="rounded-xl border border-default bg-card p-5"
    >
      <h2 className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
        <span className="text-gs-gold" aria-hidden>
          ⌥
        </span>
        what to ask in committee · {questions.length} prepared
      </h2>
      {questions.length === 0 ? (
        <p className="font-serif italic text-muted">
          No evidence-backed questions available — try again after the next ingestion run.
        </p>
      ) : (
        <ol className="divide-y divide-default">
          {questions.map((q) => (
            <li
              key={q.num}
              className="flex gap-3 py-3 last:pb-0 first:pt-0"
            >
              <span className="mt-1 min-w-[24px] font-mono text-[10px] text-dim">
                {q.num}
              </span>
              <div>
                <p className="font-serif text-[14px] leading-relaxed text-default">
                  {q.text}
                </p>
                <p className="mt-1 font-mono text-[10.5px] text-dim">{q.evidence}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
