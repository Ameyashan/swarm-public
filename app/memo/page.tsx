import type { Metadata } from "next"
import { buildMemoDraft } from "@/lib/memo/build"
import { MemoWorkspace } from "@/components/memo/memo-workspace"

export const revalidate = 300

export const metadata: Metadata = {
  title: "Memo composer · Goldman PM workspace",
  description:
    "Auto-drafted weekly credit memo for the 9 AM committee, generated from the latest detector hits, peer telemetry, and cross-fund marks.",
}

function generatedLabel(iso: string): string {
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/New_York",
  })
  return fmt.format(d).replace(/,/g, " ·") + " ET"
}

export default async function MemoComposerPage() {
  const draft = await buildMemoDraft()

  const figures = draft.sections.length
  const cites = draft.citations.length
  const readMin = Math.max(2, Math.round(figures * 0.9))

  return (
    <main className="mx-auto w-full max-w-[1240px] px-6 py-10 print:p-0">
      <nav
        className="mb-3 flex items-center gap-2 font-mono text-[11px] text-text-faint print:hidden"
        aria-label="Breadcrumb"
      >
        <a href="/" className="hover:text-accent">
          briefing
        </a>
        <span>/</span>
        <span className="text-text">memo composer</span>
      </nav>

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[1.5px] text-text-faint">
            draft v1 · auto-generated {generatedLabel(draft.generatedAt)} · last
            edited never
          </div>
          <h1 className="font-serif text-[30px] font-normal leading-[1.15] tracking-[-0.6px] text-text">
            Weekly credit memo · 9 AM committee
          </h1>
          <p className="mt-2 max-w-[680px] font-serif text-[14.5px] leading-[1.6] text-text-dim">
            Drafted from this week&rsquo;s data. The right rail controls what
            gets included; the export bar ships it. Every figure cites back to a
            detector hit or the underlying filing.
          </p>
        </div>
      </header>

      <MemoWorkspace draft={draft} />

      <footer
        className="mt-6 flex flex-col gap-1 border-t pt-4 font-mono text-[10.5px] text-text-faint sm:flex-row sm:items-center sm:justify-between print:hidden"
        style={{ borderColor: "var(--line)" }}
      >
        <span>
          memo includes {figures} section{figures === 1 ? "" : "s"} ·{" "}
          {cites} citation{cites === 1 ? "" : "s"} · est read time {readMin} min
        </span>
        <span>cited to SEC EDGAR · prepared for IC use only</span>
      </footer>
    </main>
  )
}
