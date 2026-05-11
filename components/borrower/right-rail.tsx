import Link from "next/link"
import type {
  BorrowerLeadingIndicator,
  ImpliedNextMark,
  SponsorCrossCheckRow,
} from "@/lib/borrower/queries"

function CardHeader({ title, count }: { title: string; count?: string | number }) {
  return (
    <div
      className="flex items-center justify-between border-b px-4 py-[10px]"
      style={{ borderColor: "var(--line)" }}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-faint">
        {title}
      </span>
      {count !== undefined && (
        <span className="font-mono text-[10.5px] text-text-faint">{count}</span>
      )}
    </div>
  )
}

function fmtFv(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—"
  const abs = Math.abs(n)
  const sign = n < 0 ? "−" : ""
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export function ImpliedNextCard({
  borrowerName,
  implied,
}: {
  borrowerName: string
  implied: ImpliedNextMark | null
}) {
  return (
    <section
      className="rounded-[10px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <CardHeader title="implied next mark · model estimate" />
      <div className="px-4 py-4">
        {!implied ? (
          <p className="font-serif text-[13px] italic leading-[1.55] text-text-dim">
            Not enough cross-fund history to compute an implied next mark for {borrowerName}.
          </p>
        ) : (
          <>
            <p className="mb-3 font-serif text-[13px] leading-[1.55] text-text-dim">
              {implied.rationale}
            </p>
            <div className="font-mono text-[12px]">
              {implied.goldman_next.map((g, i, arr) => (
                <div
                  key={g.fund_ticker}
                  className="flex items-baseline justify-between py-[6px]"
                  style={{
                    borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : undefined,
                  }}
                >
                  <span className="text-text-dim">{g.fund_ticker} next</span>
                  <span className="tabular-nums" style={{ color: "var(--amber)" }}>
                    {g.implied_pct === null ? "—" : `~${g.implied_pct.toFixed(1)}%`}
                    {g.current_mark_pct !== null && g.implied_pct !== null && (
                      <span className="ml-2 text-[10.5px] text-text-faint">
                        from {g.current_mark_pct.toFixed(1)}%
                      </span>
                    )}
                  </span>
                </div>
              ))}
              {implied.implied_loss_dollars !== null && (
                <div className="mt-1 flex items-baseline justify-between py-[6px]">
                  <span className="text-text-dim">implied P/L</span>
                  <span
                    className="tabular-nums"
                    style={{ color: implied.implied_loss_dollars < 0 ? "var(--red)" : "var(--green)" }}
                  >
                    {implied.implied_loss_dollars >= 0 ? "+" : ""}
                    {fmtFv(implied.implied_loss_dollars)}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
              <span
                className="inline-flex items-center rounded-full px-2 py-[2px]"
                style={{
                  background:
                    implied.confidence === "high"
                      ? "var(--amber-bg)"
                      : implied.confidence === "moderate"
                        ? "var(--bg-2)"
                        : "var(--bg-3)",
                  color:
                    implied.confidence === "high" ? "var(--amber)" : "var(--text-dim)",
                }}
              >
                {implied.confidence} confidence
              </span>
              <span>· deterministic heuristic — not a fact</span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function fmtChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}${Math.abs(n).toFixed(1)}%`
}

function changeColor(n: number | null, accrual: string | null): string {
  if (accrual === "non_accrual") return "var(--red)"
  if (n === null) return "var(--text-dim)"
  if (n <= -25) return "var(--red)"
  if (n <= -10) return "var(--amber)"
  if (n > 0) return "var(--green)"
  return "var(--text-dim)"
}

export function SponsorCrossCheckCard({
  borrowerName,
  sponsor,
  rows,
}: {
  borrowerName: string
  sponsor: string | null
  rows: SponsorCrossCheckRow[]
}) {
  return (
    <section
      className="rounded-[10px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <CardHeader
        title={sponsor ? `sponsor cross-check · ${sponsor.toLowerCase()}` : "sponsor cross-check"}
        count={sponsor ? `${rows.length}` : undefined}
      />
      <div className="px-4 py-4">
        {!sponsor ? (
          <p className="font-serif text-[13px] italic leading-[1.55] text-text-dim">
            No sponsor recorded for {borrowerName} in borrower_canonical or detector hit_data.
            Sponsor read-throughs are not available.
          </p>
        ) : rows.length === 0 ? (
          <p className="font-serif text-[13px] italic leading-[1.55] text-text-dim">
            No other Goldman-held positions tagged to {sponsor} surfaced in the recent hit slice.
          </p>
        ) : (
          <>
            <div className="mb-2 font-mono text-[11px] text-text-dim">
              Other {sponsor} names in GSCR / GSBD:
            </div>
            <ul className="flex flex-col gap-[2px] font-mono text-[12px]">
              {rows.map((r) => (
                <li
                  key={r.borrower}
                  className="flex items-baseline justify-between py-[4px]"
                  style={{ borderBottom: "1px solid var(--line)" }}
                >
                  <Link
                    href={`/borrower/${encodeURIComponent(r.borrower)}`}
                    className="truncate pr-2 font-serif text-[13px] text-text hover:underline"
                  >
                    {r.borrower}
                  </Link>
                  <span
                    className="shrink-0 tabular-nums"
                    style={{ color: changeColor(r.fv_change_pct, r.accrual_status) }}
                  >
                    {r.accrual_status === "non_accrual"
                      ? "non-accrual"
                      : r.latest_mark_pct !== null
                        ? `${r.latest_mark_pct.toFixed(1)}%`
                        : fmtChange(r.fv_change_pct)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

function leadGlyph(kind: "litigation" | "management" | "news"): { glyph: string; color: string } {
  if (kind === "litigation") return { glyph: "⚖", color: "var(--red)" }
  if (kind === "management") return { glyph: "⌥", color: "var(--amber)" }
  return { glyph: "★", color: "var(--accent)" }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
}

export function LeadingIndicatorsCard({
  indicators,
}: {
  indicators: BorrowerLeadingIndicator[]
}) {
  const litigation = indicators.filter((i) => i.kind === "litigation")
  const management = indicators.filter((i) => i.kind === "management")
  const news = indicators.filter((i) => i.kind === "news")
  const totalCount = indicators.length

  function renderSection(title: string, items: BorrowerLeadingIndicator[]) {
    if (items.length === 0) return null
    return (
      <div>
        <div
          className="border-b border-t px-4 py-[6px] font-mono text-[10px] uppercase tracking-[0.14em] text-text-faint"
          style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}
        >
          {title} · {items.length}
        </div>
        {items.slice(0, 4).map((it) => {
          const g = leadGlyph(it.kind)
          return (
            <div
              key={it.id}
              className="px-4 py-3"
              style={{ borderBottom: "1px solid var(--line)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[14px]" style={{ color: g.color }}>
                  {g.glyph}
                </span>
                <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
                  {it.category_label}
                </span>
                <span className="font-mono text-[10.5px] text-text-faint">{fmtDate(it.date)}</span>
              </div>
              <div className="mt-1 font-serif text-[13px] leading-[1.4] text-text">{it.title}</div>
              <p className="mt-1 font-serif text-[12px] leading-[1.55] text-text-dim">{it.body}</p>
              {it.source_url && (
                <a
                  href={it.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block font-mono text-[10.5px] text-accent hover:underline"
                >
                  {it.source_label ?? "source"} →
                </a>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <section
      className="rounded-[10px] border"
      style={{ background: "var(--bg-1)", borderColor: "var(--line)" }}
    >
      <CardHeader title="leading indicators" count={totalCount} />
      {totalCount === 0 ? (
        <div className="px-4 py-6 font-serif text-[13px] italic leading-[1.55] text-text-dim">
          No litigation, management, or news enrichments are linked to this borrower yet.
        </div>
      ) : (
        <div>
          {renderSection(`litigation · ${litigation.length} active`, litigation)}
          {renderSection(`management · ${management.length} change${management.length === 1 ? "" : "s"}`, management)}
          {renderSection(`news · ${news.length} signal${news.length === 1 ? "" : "s"}`, news)}
        </div>
      )}
    </section>
  )
}
