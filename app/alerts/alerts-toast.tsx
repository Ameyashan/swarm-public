"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

type Props = {
  count: number
  /** Stable signature of the active filter set. Toast re-fires on change. */
  signature: string
}

/**
 * Mount-once toast on /alerts. Re-fires whenever `signature` changes (which
 * happens when the user picks a different detector tab, fund, quarter, etc.).
 */
export function AlertsToast({ count, signature }: Props) {
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (last.current === signature) return
    const isInitial = last.current === null
    last.current = signature
    const message = isInitial
      ? `Showing ${count.toLocaleString("en-US")} alert${count === 1 ? "" : "s"} (last 30 days)`
      : `Filtered to ${count.toLocaleString("en-US")} result${count === 1 ? "" : "s"}`
    toast(message, {
      duration: 2400,
    })
  }, [count, signature])
  return null
}
