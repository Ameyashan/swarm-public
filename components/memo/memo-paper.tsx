import type {
  MemoBlock,
  MemoDraft,
  MemoInline,
  MemoSection,
} from "@/lib/memo/build"

function InlineRun({ run }: { run: MemoInline }) {
  if (run.kind === "ticker") {
    return <span className="memo-paper-ticker">{run.text}</span>
  }
  if (run.kind === "cite") {
    return <span className="memo-paper-citation">[{run.n}]</span>
  }
  return <>{run.text}</>
}

function Block({ block }: { block: MemoBlock }) {
  if (block.kind === "p") {
    return (
      <p>
        {block.runs.map((r, i) => (
          <InlineRun key={i} run={r} />
        ))}
      </p>
    )
  }
  return (
    <ul>
      {block.items.map((runs, i) => (
        <li key={i}>
          {runs.map((r, j) => (
            <InlineRun key={j} run={r} />
          ))}
        </li>
      ))}
    </ul>
  )
}

function SectionBlock({
  section,
  index,
}: {
  section: MemoSection
  index: number
}) {
  const title = index === 0 ? section.title : `${index}. ${section.title}`
  return (
    <section>
      <h2>{title}</h2>
      {section.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </section>
  )
}

export function MemoPaper({
  draft,
  includedIds,
  now,
}: {
  draft: MemoDraft
  includedIds: Set<string>
  now?: Date
}) {
  const stamp = (now ?? new Date()).toDateString()
  const included = draft.sections.filter((s) => includedIds.has(s.id))
  return (
    <article className="memo-paper" aria-label="Draft credit memo">
      <h1>Goldman BDC weekly credit memo</h1>
      <div className="memo-meta">
        From: Ameya · A. Shanbhag · GSCR/GSBD PM
        <br />
        To: Credit Committee · {stamp}
        <br />
        Subject: Goldman BDC credit memo · auto-drafted from latest filings
        {draft.asOfPeriod ? ` (data through ${draft.asOfPeriod})` : ""}
      </div>

      {included.map((s, i) => (
        <SectionBlock key={s.id} section={s} index={i} />
      ))}

      {draft.citations.length > 0 && (
        <section>
          <h2>Sources</h2>
          <ol className="memo-paper-cites">
            {draft.citations.map((c) => (
              <li key={c.n}>
                <span className="memo-paper-citation">[{c.n}]</span>{" "}
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="memo-paper-footer">
        Sources cited to SEC EDGAR. Data current as of last filing date per
        security. Prepared with swarm credit intelligence.
      </p>
    </article>
  )
}
