"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

type Props = {
  count: number
  signature: string
}

/**
 * Mount-once toast on /drift. Re-fires whenever the filter signature changes.
 */
export function DriftToast({ count, signature }: Props) {
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (last.current === signature) return
    const isInitial = last.current === null
    last.current = signature
    const message = isInitial
      ? `Showing ${count.toLocaleString("en-US")} drift candidate${count === 1 ? "" : "s"}`
      : `Filtered to ${count.toLocaleString("en-US")} result${count === 1 ? "" : "s"}`
    toast(message, { duration: 2400 })
  }, [count, signature])
  return null
}
