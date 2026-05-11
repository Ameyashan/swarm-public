"use client"

import { useCallback, useState } from "react"
import type { MemoDraft } from "@/lib/memo/build"
import { MemoPaper } from "./memo-paper"
import { MemoSide } from "./memo-side"

export function MemoWorkspace({ draft }: { draft: MemoDraft }) {
  const [includedIds, setIncludedIds] = useState<Set<string>>(
    () =>
      new Set(
        draft.sections.filter((s) => s.defaultOn).map((s) => s.id),
      ),
  )

  const onToggle = useCallback((id: string) => {
    setIncludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="memo-grid">
      <MemoPaper draft={draft} includedIds={includedIds} />
      <MemoSide draft={draft} includedIds={includedIds} onToggle={onToggle} />
    </div>
  )
}
