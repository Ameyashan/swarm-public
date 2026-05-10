import { Scaffold } from "@/components/scaffold"

export const metadata = { title: "Patterns" }

export default function PatternsPage() {
  return (
    <Scaffold
      eyebrow="future · cross-borrower patterns"
      title="Patterns"
      lede="Sector clusters, vintage cohorts, and cross-borrower pattern queries with empirical backtests. The composer surfaces above translate plain-language questions into the right pattern query."
      commit="Commit 6"
      next={[
        "Pattern composer: free-text → structured filter compilation",
        "Saved patterns library with backtest n + lift per pattern",
        "Sector cluster view (healthcare consolidators, software roll-ups, etc.)",
        "Vintage cohort view: origination quarter × current severity",
      ]}
    />
  )
}
