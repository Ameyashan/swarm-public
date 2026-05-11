import type {
  BorrowerLatestMark,
  BorrowerLeadingIndicator,
  BorrowerMeta,
} from "./queries"

export type SummarySpan =
  | { kind: "text"; text: string }
  | { kind: "gs"; text: string }
  | { kind: "crit"; text: string }
  | { kind: "warn"; text: string }

function quarterLabel(iso: string | null): string {
  if (!iso) return "the latest period"
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${q}Q ’${yy}`
}

/**
 * Build a deterministic editorial sentence summarizing the borrower's
 * cross-fund mark situation. All facts trace back to live query results.
 */
export function buildBorrowerSummary(
  meta: BorrowerMeta,
  latest: BorrowerLatestMark[],
  leads: BorrowerLeadingIndicator[],
): SummarySpan[] {
  const out: SummarySpan[] = []
  const push = (s: string) => out.push({ kind: "text", text: s })

  // Holders clause.
  const fundsHeld = meta.funds_holding
  if (fundsHeld.length === 0) {
    push(
      `${meta.canonical_name} has no observable BDC positions in the available dataset since 2024-03-31.`,
    )
    return out
  }
  push("Held by ")
  fundsHeld.forEach((f, i) => {
    const isGold = f === "GSCR" || f === "GSBD"
    out.push({ kind: isGold ? "gs" : "text", text: f })
    if (i < fundsHeld.length - 1) push(i === fundsHeld.length - 2 ? ", and " : ", ")
  })
  push(". ")

  // Mark range / spread.
  const marks = latest
    .map((l) => l.mark_pct)
    .filter((x): x is number => x !== null)
  if (marks.length >= 2) {
    const lo = Math.min(...marks)
    const hi = Math.max(...marks)
    const spread = Math.round((hi - lo) * 10) / 10
    push("Latest marks span ")
    out.push({ kind: "gs", text: `${lo.toFixed(1)}% to ${hi.toFixed(1)}%` })
    push(
      ` — a ${spread.toFixed(1)}pp spread${
        spread >= 1 ? " on a security where peers diverge meaningfully" : ""
      }. `,
    )
  } else if (marks.length === 1) {
    push("Single live fund mark of ")
    out.push({ kind: "gs", text: `${marks[0].toFixed(1)}%` })
    push(". ")
  }

  // Worst mark callout — if a non-Goldman fund holds the worst mark and spread ≥ 1pp.
  if (meta.worst_mark && meta.best_mark && meta.cross_fund_spread_pp !== null) {
    const worst = meta.worst_mark
    const best = meta.best_mark
    const worstIsPeer = !worst.is_goldman
    const bestIsGold = best.is_goldman
    if (worstIsPeer && bestIsGold && meta.cross_fund_spread_pp >= 0.5 && worst.mark_pct !== null) {
      out.push({
        kind: "crit",
        text: `${worst.fund_ticker} has cut the mark to ${worst.mark_pct.toFixed(1)}%`,
      })
      push(
        ` in ${quarterLabel(worst.period_end)} while Goldman holds at ${best.mark_pct?.toFixed(1)}% — peer marking ahead of Goldman. `,
      )
    } else if (meta.has_critical_hit) {
      push(`Severity-70+ detector signal active on this name. `)
    }
  }

  // Recent leading event callout.
  const recentLead = leads[0]
  if (recentLead) {
    push("Recent leading signal: ")
    out.push({
      kind: recentLead.kind === "litigation" ? "warn" : "text",
      text: `${recentLead.category_label} — ${recentLead.title}`,
    })
    push(". ")
  }

  // Non-accrual / PIK.
  if (meta.any_non_accrual) {
    out.push({ kind: "crit", text: "One or more holders mark this position non-accrual." })
    push(" ")
  } else if (meta.any_pik) {
    out.push({ kind: "warn", text: "PIK interest active on at least one tranche." })
    push(" ")
  }

  return out
}
