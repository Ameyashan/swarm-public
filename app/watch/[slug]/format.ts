// DEPRECATED: do not add new helpers here. Use `@/lib/format` instead.
// This file remains as a thin compat shim so existing imports keep working.

import { formatFV, formatPct, formatQuarter } from "@/lib/format"

export function fmtUsdFromThousands(
  t: number | null | undefined,
  fundTicker?: string | null,
): string {
  return formatFV(t, fundTicker)
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  return formatPct(n, { digits })
}

export function fmtPeriodShort(s: string | null | undefined): string {
  return formatQuarter(s)
}
