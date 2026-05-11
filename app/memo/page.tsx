import { Scaffold } from "@/components/scaffold"

export const metadata = { title: "Memo composer" }

export default function MemoComposerPage() {
  return (
    <Scaffold
      eyebrow="future · memo composer"
      title="Memo composer"
      lede="Compose the weekly credit committee memo with one-click insertion of briefing prose, top forward signals, peer-rank pins, and pattern findings — every figure cited back to the underlying detector hit or enrichment."
      commit="Commit 7"
      next={[
        "WYSIWYG editor seeded from today's briefing",
        "Insert blocks: forward signal, peer pin, pattern card, headline",
        "Citations panel with hover-resolved source URLs",
        "Export: docx, PDF, Slack #credit-cmte share",
      ]}
    />
  )
}
