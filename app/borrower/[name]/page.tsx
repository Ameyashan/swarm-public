import { Scaffold } from "@/components/scaffold"

export const metadata = { title: "Borrower x-ray" }

export default function BorrowerXrayPage({
  params,
}: {
  params: { name: string }
}) {
  const name = decodeURIComponent(params.name)
  return (
    <Scaffold
      eyebrow={`future · borrower x-ray · ${name}`}
      title={name}
      lede={`Full x-ray for ${name}: every BDC mark, enrichment events (litigation / management / news), cross-fund spread history, and back-tested follow-up rates — assembled on a single page for IC prep.`}
      commit="Commit 4"
      next={[
        "Per-period mark table across all BDCs holding the name",
        "Litigation / management / news event timeline from enrichments",
        "Severity ring + 8-quarter trajectory + accrual / PIK overlays",
        "Cross-fund spread chart + leading-indicator backtest",
      ]}
    />
  )
}
