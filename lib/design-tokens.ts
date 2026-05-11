// Centralized design tokens for the Swarm PM workspace.
// Keep this file in sync with tailwind.config.ts and app/globals.css.
//
// Strict semantics — do not reuse a color outside its assigned role:
//   accent  (terracotta)  — editorial accent / headline block only
//   gs      (Goldman gold) — Goldman identity / GSCR + GSBD / ★ glyphs
//   red     (brick red)    — critical severity only (sev >= 70)
//   amber   (mustard)      — watch signal only (sev 40-70 / elevated PIK)
//   green   (sage)         — healthy / positive credit signal only

export const colors = {
  bg: "#f5f1e8",
  bg1: "#faf7ee",
  bg2: "#efe9d9",
  bg3: "#e7e0cc",
  line: "#d8cfb5",
  line2: "#c2b899",
  text: "#2a2520",
  textDim: "#6b6358",
  textFaint: "#948b7c",
  accent: "#bd5d3c",
  accentSoft: "#f0d9cb",
  red: "#a8412a",
  redBg: "#f3dcd2",
  amber: "#a8841f",
  amberBg: "#f0e4c0",
  green: "#4a7c4f",
  greenBg: "#d9e6d2",
  gs: "#8a6f1d",
  gsBg: "rgba(138, 111, 29, 0.08)",
} as const

export type Severity = "critical" | "watch" | "info" | "ok"

/** Bucket a 0-100 severity into a strict semantic. */
export function severityBucket(sev100: number): Severity {
  if (sev100 >= 70) return "critical"
  if (sev100 >= 40) return "watch"
  return "info"
}
