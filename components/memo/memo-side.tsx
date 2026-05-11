"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import type { MemoDraft, MemoSection } from "@/lib/memo/build"
import { exportMemoDocx } from "@/app/memo/actions"

type Tone = "institutional" | "conservative" | "technical" | "brief"

function plainTextForSection(section: MemoSection): string {
  const out: string[] = [section.title]
  for (const block of section.blocks) {
    if (block.kind === "p") {
      out.push(
        block.runs
          .map((r) =>
            r.kind === "text" ? r.text : r.kind === "ticker" ? r.text : `[${r.n}]`,
          )
          .join(""),
      )
    } else {
      for (const item of block.items) {
        out.push(
          "• " +
            item
              .map((r) =>
                r.kind === "text"
                  ? r.text
                  : r.kind === "ticker"
                    ? r.text
                    : `[${r.n}]`,
              )
              .join(""),
        )
      }
    }
  }
  return out.join("\n")
}

function downloadBase64(filename: string, base64: string, mime: string) {
  const bin = atob(base64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function MemoSide({
  draft,
  includedIds,
  onToggle,
}: {
  draft: MemoDraft
  includedIds: Set<string>
  onToggle: (id: string) => void
}) {
  const [tone, setTone] = useState<Tone>("institutional")
  const [pending, startTransition] = useTransition()

  const includedCount = includedIds.size
  const totalCount = draft.sections.length

  const includedSections = useMemo(
    () => draft.sections.filter((s) => includedIds.has(s.id)),
    [draft.sections, includedIds],
  )

  function buildPlainText() {
    const lines: string[] = [
      "Goldman BDC weekly credit memo",
      `Generated: ${new Date(draft.generatedAt).toLocaleString()}`,
      draft.asOfPeriod ? `Data through: ${draft.asOfPeriod}` : "",
      "",
    ]
    for (const s of includedSections) {
      lines.push(plainTextForSection(s))
      lines.push("")
    }
    if (draft.citations.length > 0) {
      lines.push("Sources:")
      for (const c of draft.citations) {
        lines.push(`[${c.n}] ${c.label}${c.url ? ` — ${c.url}` : ""}`)
      }
    }
    return lines.filter((l) => l !== undefined).join("\n")
  }

  function handleDocx() {
    const ids = Array.from(includedIds)
    if (ids.length === 0) {
      toast.error("Select at least one section to include.")
      return
    }
    startTransition(async () => {
      const res = await exportMemoDocx(ids)
      if (res.ok) {
        downloadBase64(
          res.filename,
          res.base64,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        toast.success(`Exported ${res.filename}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  function handlePdf() {
    toast.message("Opening print dialog — save as PDF.")
    setTimeout(() => window.print(), 50)
  }

  async function handleSlack() {
    try {
      await navigator.clipboard.writeText(buildPlainText())
      toast.success("Memo copied — paste into #credit-cmte")
    } catch {
      toast.error("Clipboard blocked. Try the Word export instead.")
    }
  }

  function handleEmail() {
    const subject = encodeURIComponent("Goldman BDC weekly credit memo")
    const body = encodeURIComponent(buildPlainText().slice(0, 1800))
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self")
  }

  return (
    <aside className="memo-side print:hidden">
      <div className="memo-card">
        <h4>
          included sections · {includedCount} of {totalCount}
        </h4>
        {draft.sections.map((s) => {
          const on = includedIds.has(s.id)
          return (
            <label
              key={s.id}
              className="memo-toggle"
              onClick={(e) => {
                if ((e.target as HTMLElement).tagName !== "INPUT") {
                  e.preventDefault()
                  onToggle(s.id)
                }
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(s.id)}
              />
              <div className="flex-1">
                <div className="text-text">{s.title}</div>
                <div className="font-mono text-[10px] text-text-faint">
                  {s.subtitle}
                </div>
              </div>
            </label>
          )
        })}
      </div>

      <div className="memo-card">
        <h4>tone</h4>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {(
            ["institutional", "conservative", "technical", "brief"] as const
          ).map((t) => {
            const active = tone === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                className="rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.6px]"
                style={{
                  background: active ? "var(--gs-bg)" : "var(--bg-2)",
                  borderColor: active ? "var(--gs)" : "var(--line)",
                  color: active ? "var(--gs)" : "var(--text-dim)",
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>

      <div className="memo-card">
        <h4>export</h4>
        <div className="export-grid">
          <button
            type="button"
            className="export-btn"
            onClick={handleDocx}
            disabled={pending}
          >
            {pending ? "…building" : "↗ Word .docx"}
          </button>
          <button type="button" className="export-btn" onClick={handlePdf}>
            ↗ PDF
          </button>
          <button type="button" className="export-btn" onClick={handleSlack}>
            ↗ Slack thread
          </button>
          <button type="button" className="export-btn" onClick={handleEmail}>
            ↗ Email draft
          </button>
        </div>
      </div>

      <div className="memo-card">
        <h4>memory · learning your voice</h4>
        <div
          className="px-4 py-3 font-serif italic"
          style={{
            fontSize: "12.5px",
            lineHeight: 1.55,
            color: "var(--text-dim)",
          }}
        >
          After four weeks of edits, drafts will mirror your phrasing and section
          preferences. Currently using the{" "}
          <span className="not-italic" style={{ color: "var(--gs)" }}>
            {tone}
          </span>{" "}
          default.
        </div>
      </div>
    </aside>
  )
}
