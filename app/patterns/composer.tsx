"use client"

import Link from "next/link"
import { useState, useTransition, useMemo } from "react"
import { parseAction, savePatternAction } from "./actions"
import {
  CHIP_KEYS,
  CHIP_KEY_LABEL,
  chipLabel,
  EMPTY_FILTERS,
  type PatternFilters,
  type ParsedQuery,
} from "@/lib/patterns/schema"

const EXAMPLES = [
  "show me Sun Capital portfolio companies with any litigation in the last year",
  "GSCR positions originated in 2024 with PIK rate above 5%",
  "software borrowers held by 3+ BDCs where Goldman marks above peer median",
  "non-accrual borrowers where the sponsor has 2+ other names in our book",
] as const

const DEFAULT_QUERY =
  "Goldman positions with management changes in the last 6 months where the mark cut more than 30%"

type ComposerRow = {
  borrower: string
  fund_tickers: string[]
  max_severity: number
  hit_count: number
  n_litigation: number
  n_mgmt: number
  n_news: number
  fv_dollars: number | null
  is_pik: boolean
  any_non_accrual: boolean
  goldman_held: boolean
  sponsor: string | null
  industry: string | null
  all_funds_holding: string[]
}

export type ComposerResultsClient = {
  rows: ComposerRow[]
  total: number
  avg_severity: number
  total_fv_dollars: number
  query_plan: string[]
}

type Props = {
  initialQuery: string
  initialParsed: ParsedQuery
  initialResults: ComposerResultsClient
  initialParseError?: string | null
}

export function PatternsComposer({
  initialQuery,
  initialParsed,
  initialResults,
  initialParseError,
}: Props) {
  const [query, setQuery] = useState(initialQuery || DEFAULT_QUERY)
  const [pending, startTransition] = useTransition()
  const [showPlan, setShowPlan] = useState(false)
  const [parsed, setParsed] = useState<ParsedQuery>(initialParsed)
  const [results, setResults] = useState<ComposerResultsClient>(initialResults)
  const [parseError, setParseError] = useState<string | null>(initialParseError ?? null)
  const [saveState, setSaveState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; id: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" })

  const hasFilters = useMemo(
    () => CHIP_KEYS.some((k) => parsed.filters[k] != null),
    [parsed],
  )

  function runQuery(text: string) {
    setParseError(null)
    setSaveState({ kind: "idle" })
    startTransition(async () => {
      const parseRes = await parseAction(text)
      if (!parseRes.ok) {
        setParseError(parseRes.error)
        return
      }
      setParsed(parseRes.parsed)
      const exec = await fetch("/patterns/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters: parseRes.parsed.filters }),
      })
      if (!exec.ok) {
        setParseError(`Query failed: HTTP ${exec.status}`)
        return
      }
      const data = (await exec.json()) as ComposerResultsClient
      setResults(data)
    })
  }

  function handleRun() {
    if (!query.trim()) return
    runQuery(query)
  }

  function handleExample(s: string) {
    setQuery(s)
    runQuery(s)
  }

  async function handleSave() {
    setSaveState({ kind: "saving" })
    const res = await savePatternAction({
      label: query.trim().slice(0, 120) || "Untitled pattern",
      query,
      filters: parsed.filters,
    })
    if (res.ok) setSaveState({ kind: "saved", id: res.id })
    else setSaveState({ kind: "error", message: res.error })
  }

  // ── Compose query plan summary ─────────────────────────────────────────────
  const planLines = results.query_plan

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <section
      className="rounded-r-[12px] border border-l-[2px] p-[22px_24px]"
      style={{
        background:
          "linear-gradient(180deg, rgba(189,93,60,0.05), transparent 60%)",
        borderColor: "var(--accent-soft)",
        borderLeftColor: "var(--accent)",
      }}
    >
      <div className="mb-[10px] flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1.8px] text-accent">
        ⌥ define your own pattern
        <span
          className="rounded-[3px] border px-[5px] py-[1px] text-[9px]"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          beta
        </span>
      </div>

      {/* INPUT */}
      <div
        className="mb-[14px] flex items-center gap-[10px] rounded-[10px] border px-4 py-[14px]"
        style={{
          background: "var(--bg-1)",
          borderColor: "var(--line)",
        }}
      >
        <span
          className="font-mono text-[16px] leading-none text-accent"
          aria-hidden
        >
          ›
        </span>
        <input
          className="flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-text-faint"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
              e.preventDefault()
              handleRun()
            }
          }}
          placeholder="Ask a question in plain English…"
          aria-label="Pattern query"
        />
        <button
          onClick={handleRun}
          disabled={pending}
          className="flex items-center gap-[6px] rounded-[6px] border-0 px-4 py-2 font-mono text-[11px] font-semibold text-bg disabled:opacity-60"
          style={{ background: "var(--accent)" }}
        >
          {pending ? "running…" : "run"}{" "}
          <span
            className="rounded-[2px] px-1 py-[1px] text-[9px]"
            style={{ background: "rgba(0,0,0,0.15)" }}
          >
            ⌘↵
          </span>
        </button>
      </div>

      {/* EXAMPLES */}
      <div className="mb-1 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => handleExample(ex)}
            className="rounded-[18px] border px-3 py-[7px] font-serif text-[12.5px] italic text-text-dim transition-colors hover:bg-accent-soft hover:text-accent"
            style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
          >
            “{ex}”
          </button>
        ))}
      </div>

      {/* INTERPRETATION */}
      <div
        className="mt-[14px] rounded-[8px] border px-[14px] py-3"
        style={{ background: "var(--bg-2)", borderColor: "var(--line)" }}
      >
        <div className="mb-2 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[1.2px] text-text-faint">
          <span>structured interpretation · {hasFilters ? "click any chip to refine" : "no filters parsed yet"}</span>
          <span className="font-mono normal-case tracking-normal text-text-dim">
            {pending ? "parsing…" : `sonnet · ${MODEL_LABEL}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-[6px]">
          {hasFilters ? (
            CHIP_KEYS.map((k) => {
              const v = parsed.filters[k]
              if (v == null) return null
              const isGuess = parsed.field_confidence[k] === "guess"
              return (
                <Chip
                  key={k}
                  keyLabel={CHIP_KEY_LABEL[k]}
                  value={chipLabel(k, parsed.filters) ?? "—"}
                  guess={isGuess}
                  onRemove={() => {
                    const next: PatternFilters = { ...parsed.filters, [k]: null } as PatternFilters
                    setParsed({ ...parsed, filters: next })
                    startTransition(async () => {
                      const exec = await fetch("/patterns/api/run", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ filters: next }),
                      })
                      if (exec.ok) {
                        const data = (await exec.json()) as ComposerResultsClient
                        setResults(data)
                      }
                    })
                  }}
                />
              )
            })
          ) : (
            <span className="font-mono text-[11px] text-text-faint">
              No filters yet — try one of the example chips above or type a question.
            </span>
          )}
        </div>
        {parsed.rationale ? (
          <div
            className="mt-[10px] border-t pt-[10px] font-serif text-[12.5px] italic leading-[1.55] text-text-dim"
            style={{ borderColor: "var(--line)" }}
          >
            {parsed.rationale}
          </div>
        ) : null}
        {parseError ? (
          <div
            className="mt-[10px] rounded-[6px] border px-3 py-2 font-mono text-[11px]"
            style={{ background: "var(--red-bg)", borderColor: "var(--red)", color: "var(--red)" }}
          >
            {parseError}
          </div>
        ) : null}
      </div>

      {/* RESULT BAR */}
      <div
        className="mt-[14px] flex flex-wrap items-center justify-between gap-3 rounded-[8px] px-[14px] py-[10px] font-mono text-[11px]"
        style={{ background: "var(--bg-2)" }}
      >
        <div className="text-text">
          <span
            className="mr-1 text-[14px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            {results.total}
          </span>
          borrowers match
          <span className="text-text-dim">
            {" · "}avg severity {Math.round(results.avg_severity)} ·{" "}
            {results.total_fv_dollars > 0
              ? `$${(results.total_fv_dollars / 1_000_000).toFixed(0)}M FV`
              : "—"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saveState.kind === "saving" || results.total === 0}
            className="rounded-[5px] border px-3 py-[5px] text-[11px] text-text-dim disabled:opacity-50"
            style={{
              borderColor: "var(--line-2)",
              background: "var(--bg-1)",
            }}
          >
            {saveState.kind === "saving"
              ? "saving…"
              : saveState.kind === "saved"
              ? "✓ saved"
              : "save as pattern"}
          </button>
          <span
            className="cursor-pointer rounded-[5px] border px-3 py-[5px] text-[11px] text-text-faint"
            style={{ borderColor: "var(--line-2)" }}
            title="Memo composer ships in Commit 6"
          >
            add to memo
          </span>
        </div>
      </div>
      {saveState.kind === "error" ? (
        <div
          className="mt-[8px] rounded-[6px] border px-3 py-2 font-mono text-[10.5px]"
          style={{ background: "var(--red-bg)", borderColor: "var(--red)", color: "var(--red)" }}
        >
          {saveState.message}
        </div>
      ) : null}

      {/* QUERY PLAN TOGGLE */}
      <button
        onClick={() => setShowPlan(!showPlan)}
        className="mt-[6px] font-mono text-[10px] text-text-faint hover:text-accent"
      >
        {showPlan ? "▴ hide query plan" : "▾ show query plan"}
      </button>
      {showPlan ? (
        <pre
          className="mt-[10px] overflow-x-auto whitespace-pre rounded-[6px] border px-3 py-[10px] font-mono text-[10.5px] leading-[1.55] text-text-dim"
          style={{ background: "#ede5d0", borderColor: "var(--line)" }}
        >
{`-- pattern composer · plan over public.detector_hits / enrichments / observations / borrower_canonical
${planLines.length > 0 ? planLines.map((l) => "filter  " + l).join("\n") : "filter  (no filters — full Goldman recent slice)"}
project borrower, fund_tickers, max(severity), n_lit, n_mgmt, n_news, fv_dollars, accrual, is_pik, sponsor, industry
group   by portfolio_company_canonical
sort    max(severity) desc
limit   50`}
        </pre>
      ) : null}

      {/* RESULTS TABLE */}
      <div className="mt-5">
        {results.rows.length === 0 ? (
          <div
            className="rounded-[8px] border px-4 py-6 text-center font-serif italic text-text-dim"
            style={{
              background: "var(--bg-1)",
              borderColor: "var(--line)",
            }}
          >
            No borrowers match these filters. Try removing a chip above, widening the window, or lowering the severity threshold.
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-[10px] border"
            style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
          >
            <div
              className="grid grid-cols-[1.4fr_60px_60px_60px_80px_90px] gap-[14px] border-b px-4 py-[6px] font-mono text-[9.5px] uppercase tracking-[1px] text-text-faint"
              style={{ background: "var(--bg-2)", borderColor: "var(--line)" }}
            >
              <div>borrower</div>
              <div className="text-center">sev</div>
              <div className="text-center">litig</div>
              <div className="text-center">mgmt</div>
              <div className="text-center">FV</div>
              <div className="text-right">funds</div>
            </div>
            {results.rows.map((r) => (
              <Link
                key={r.borrower}
                href={`/borrower/${encodeURIComponent(r.borrower)}`}
                className="grid grid-cols-[1.4fr_60px_60px_60px_80px_90px] items-center gap-[14px] border-b px-4 py-[10px] text-[13px] no-underline transition-colors hover:bg-bg-2"
                style={{
                  borderColor: "var(--line)",
                  background: r.goldman_held ? "rgba(138,111,29,0.05)" : undefined,
                }}
              >
                <div>
                  <div
                    className="font-medium"
                    style={{ color: r.goldman_held ? "var(--gs)" : "var(--text)" }}
                  >
                    {r.borrower}
                  </div>
                  <div className="mt-[2px] font-mono text-[10px] text-text-faint">
                    <span style={{ color: r.goldman_held ? "var(--gs)" : "var(--text-dim)" }}>
                      {(r.goldman_held
                        ? r.fund_tickers
                            .map((t) => `${t}${["GSCR", "GSBD"].includes(t) ? " ★" : ""}`)
                            .join(" ")
                        : r.fund_tickers.join(" ")) || "—"}
                    </span>
                    {r.sponsor ? ` · ${r.sponsor}` : ""}
                    {r.industry ? ` · ${r.industry}` : ""}
                    {r.any_non_accrual ? (
                      <span style={{ color: "var(--red)" }}> · non-accrual</span>
                    ) : null}
                    {r.is_pik ? <span style={{ color: "var(--amber)" }}> · PIK</span> : null}
                  </div>
                </div>
                <div
                  className="text-center font-mono text-[11px]"
                  style={{
                    color:
                      r.max_severity >= 70
                        ? "var(--red)"
                        : r.max_severity >= 40
                        ? "var(--amber)"
                        : "var(--text-dim)",
                  }}
                >
                  {r.max_severity}
                </div>
                <div className="text-center font-mono text-[11px]" style={{ color: r.n_litigation > 0 ? "var(--red)" : "var(--text-faint)" }}>
                  {r.n_litigation}
                </div>
                <div className="text-center font-mono text-[11px]" style={{ color: r.n_mgmt > 0 ? "var(--amber)" : "var(--text-faint)" }}>
                  {r.n_mgmt}
                </div>
                <div className="text-center font-mono text-[11px] text-text-dim">
                  {r.fv_dollars && r.fv_dollars > 0
                    ? `$${(r.fv_dollars / 1_000_000).toFixed(1)}M`
                    : "—"}
                </div>
                <div className="text-right font-mono text-[10.5px] text-text-faint">
                  {r.all_funds_holding.length > 0 ? r.all_funds_holding.length : "—"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const MODEL_LABEL = "claude-sonnet-4-20250514"

function Chip({
  keyLabel,
  value,
  guess,
  onRemove,
}: {
  keyLabel: string
  value: string
  guess: boolean
  onRemove: () => void
}) {
  return (
    <span
      className="inline-flex items-center gap-[6px] rounded-[5px] border px-[10px] py-[5px] font-mono text-[11px]"
      style={{
        background: guess ? "var(--amber-bg)" : "var(--bg-3)",
        borderColor: guess ? "var(--amber)" : "var(--line-2)",
        borderStyle: guess ? "dashed" : "solid",
        color: guess ? "var(--amber)" : "var(--text)",
      }}
    >
      <span className="text-[10px] uppercase tracking-[0.8px] text-text-faint">
        {keyLabel}
      </span>
      <span className="font-medium" style={{ color: guess ? "var(--amber)" : "var(--text)" }}>
        {value}
      </span>
      <button
        onClick={onRemove}
        className="ml-1 text-[10px] text-text-faint hover:text-accent"
        title="Remove filter"
        aria-label={`Remove ${keyLabel} filter`}
      >
        ×
      </button>
    </span>
  )
}
