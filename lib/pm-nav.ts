// Six surfaces of the PM workflow, in the exact order required by the spec.
// Path "/borrower/MRI%20Software" matches the prompt verbatim — the borrower
// X-ray landing route uses MRI Software as the default canonical example.
//
// Kept in a plain (non-"use client") module so both server components
// (e.g. app/not-found.tsx) and the client navbar can import it.
export type PmNavLink = {
  href: string
  label: string
  match: string // pathname prefix that should highlight this nav entry
}

export const PM_NAV: PmNavLink[] = [
  { href: "/", label: "Briefing", match: "/" },
  { href: "/book", label: "Position book", match: "/book" },
  // Use the exact canonical name as it appears in observations
  // (`MRI Software LLC`). The borrower x-ray does an `.eq()` lookup against
  // `portfolio_company_canonical`, so an inexact alias would render blank.
  {
    href: `/borrower/${encodeURIComponent("MRI Software LLC")}`,
    label: "Borrower x-ray",
    match: "/borrower",
  },
  { href: "/peer", label: "Peer telemetry", match: "/peer" },
  { href: "/patterns", label: "Patterns", match: "/patterns" },
  { href: "/memo", label: "Memo composer", match: "/memo" },
]

export function isActiveNav(pathname: string | null, match: string): boolean {
  if (!pathname) return false
  if (match === "/") return pathname === "/"
  return pathname === match || pathname.startsWith(`${match}/`)
}
