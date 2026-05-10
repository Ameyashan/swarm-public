import Link from "next/link"
import { GOLDMAN_FUNDS, type GoldmanFund, type BookTab } from "@/lib/book/queries"

export function FundSwitch({ fund, tab }: { fund: GoldmanFund; tab: BookTab }) {
  return (
    <div
      role="group"
      aria-label="Switch fund"
      className="inline-flex items-center gap-0 rounded-[6px] border p-[2px]"
      style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}
    >
      {GOLDMAN_FUNDS.map((f) => {
        const active = f === fund
        return (
          <Link
            key={f}
            href={`/book?fund=${f}&tab=${tab}`}
            className="rounded-[4px] px-3 py-1 font-mono text-[11.5px] transition-colors"
            style={{
              background: active ? "var(--gs)" : "transparent",
              color: active ? "var(--bg)" : "var(--text-dim)",
              fontWeight: active ? 600 : 400,
            }}
            aria-current={active ? "true" : "false"}
          >
            {f}
          </Link>
        )
      })}
    </div>
  )
}
