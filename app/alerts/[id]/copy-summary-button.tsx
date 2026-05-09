"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export function CopySummaryButton({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false)

  async function onClick() {
    try {
      // navigator.clipboard requires HTTPS or localhost. Fall back to a textarea
      // hack so this still works in misconfigured iframes / older browsers.
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard.writeText(markdown)
      } else {
        const ta = document.createElement("textarea")
        ta.value = markdown
        ta.setAttribute("readonly", "")
        ta.style.position = "absolute"
        ta.style.left = "-9999px"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.error("copy failed", err)
    }
  }

  return (
    <Button onClick={onClick} variant="outline" size="sm">
      {copied ? "Copied" : "Copy alert summary"}
    </Button>
  )
}
