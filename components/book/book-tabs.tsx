import Link from "next/link"
import {
  BOOK_TAB_LABEL,
  BOOK_TAB_ORDER,
  type BookTab,
  type GoldmanFund,
} from "@/lib/book/queries"

type Props = {
  fund: GoldmanFund
  active: BookTab
  counts: Record<BookTab, number>
  totalLive: number
}

/** Server-rendered tab strip — each tab is a link with ?tab=X. */
export function BookTabs({ fund, active, counts, totalLive }: Props) {
  return (
    <nav
      aria-label="Position book tabs"
      className="flex flex-wrap gap-1 border-b pb-3"
      style={{ borderColor: "var(--line)" }}
    >
      {BOOK_TAB_ORDER.map((tab) => {
        const isActive = tab === active
        const href = `/book?fund=${fund}&tab=${tab}`
        const labelBase =
          tab === "all" ? `All ${totalLive.toLocaleString()}` : BOOK_TAB_LABEL[tab]

        let pill: { n: number; tone: "crit" | "warn" | "neutral" } | null = null
        if (tab === "deteriorating" && counts.deteriorating > 0) {
          pill = { n: counts.deteriorating, tone: "crit" }
        } else if (tab === "watchlist" && counts.watchlist > 0) {
          pill = { n: counts.watchlist, tone: "warn" }
        } else if (tab === "non_accrual" && counts.non_accrual > 0) {
          pill = { n: counts.non_accrual, tone: "crit" }
        }

        const pillBg =
          pill?.tone === "crit"
            ? "var(--red-bg)"
            : pill?.tone === "warn"
              ? "var(--amber-bg)"
              : "var(--bg-2)"
        const pillFg =
          pill?.tone === "crit"
            ? "var(--red)"
            : pill?.tone === "warn"
              ? "var(--amber)"
              : "var(--text-dim)"

        return (
          <Link
            key={tab}
            href={href}
            className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-[7px] font-mono text-[11.5px] transition-colors"
            style={{
              background: isActive ? "var(--bg-2)" : "transparent",
              color: isActive ? "var(--text)" : "var(--text-dim)",
              border: `1px solid ${isActive ? "var(--line)" : "transparent"}`,
            }}
            aria-current={isActive ? "page" : undefined}
          >
            <span>{labelBase}</span>
            {pill && (
              <span
                className="rounded-full px-[7px] py-[1px] font-mono text-[10px] font-medium"
                style={{ background: pillBg, color: pillFg }}
              >
                {pill.n}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
