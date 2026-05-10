import type { CommitteeQuestion } from "@/lib/briefing/derive"

export function CommitteeQuestions({
  questions,
}: {
  questions: CommitteeQuestion[]
}) {
  return (
    <section
      aria-label="Committee questions"
      className="rounded-[10px] border px-5 py-[18px]"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <h2 className="mb-3 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-dim">
        <span className="text-gs" aria-hidden>
          ⌥
        </span>
        what to ask in committee · {questions.length} prepared
      </h2>
      {questions.length === 0 ? (
        <p className="font-serif italic text-text-dim">
          No evidence-backed questions available — try again after the next
          ingestion run.
        </p>
      ) : (
        <ol>
          {questions.map((q, i) => (
            <li
              key={q.num}
              className="flex gap-3 py-[10px]"
              style={{
                borderTop:
                  i === 0 ? "none" : "0.5px solid var(--line)",
              }}
            >
              <span className="mt-[2px] min-w-[24px] font-mono text-[10px] text-text-faint">
                {q.num}
              </span>
              <div>
                <p className="font-serif text-[14px] leading-[1.55] text-text">
                  {q.text}
                </p>
                <p className="mt-1 font-mono text-[10.5px] text-text-faint">
                  {q.evidence}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
