import { Scaffold } from "@/components/scaffold"

export const metadata = { title: "Position book" }

export default function PositionBookPage() {
  return (
    <Scaffold
      eyebrow="future · position book"
      title="Position book"
      lede="Every GSCR + GSBD position, ranked by current severity, with the levers that matter for committee — fair value, accrual, PIK share, cross-fund peer marks, and detector activity."
      commit="Commit 3"
      next={[
        "Sortable observations grid joined to detector_hits and enrichments",
        "Per-position severity ring + 8-quarter mark trajectory",
        "Filter chips: fund, accrual status, sector, detector",
        "Row → /borrower/[name] x-ray drill-in",
      ]}
    />
  )
}
