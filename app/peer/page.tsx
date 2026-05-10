import { Scaffold } from "@/components/scaffold"

export const metadata = { title: "Peer telemetry" }

export default function PeerTelemetryPage() {
  return (
    <Scaffold
      eyebrow="future · peer telemetry"
      title="Peer telemetry"
      lede="Goldman pinned across credit-quality dimensions vs the BDC universe. Use this surface when LP, IR, or risk asks ‘are we worse than peers?’"
      commit="Commit 5"
      next={[
        "Full per-fund peer table: PIK %, non-accrual %, hit rate, FV scale",
        "Percentile pin chart with toggleable normalization (rate vs count)",
        "Cross-fund spread heatmap for shared borrowers",
        "Quarter-over-quarter delta view",
      ]}
    />
  )
}
