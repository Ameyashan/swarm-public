import type { Config } from "tailwindcss";

/*
  Literal palette from the Commit 1 contract. Keep these in lockstep with
  app/globals.css (CSS variables) and lib/design-tokens.ts. Any new color must
  exist here AND in globals.css AND must map to a documented semantic role.

  Strict semantics:
    accent (terracotta)  — editorial accent / headline block only
    gs     (Goldman gold) — Goldman identity / GSCR + GSBD / ★ glyphs
    red    (brick red)    — critical severity only (sev >= 70)
    amber  (mustard)      — watch signal only (sev 40-70 / elevated PIK)
    green  (sage)         — healthy / positive credit signal only
*/

const tokens = {
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
} as const;

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        serif: [
          "var(--font-serif)",
          "Source Serif Pro",
          "Source Serif 4",
          "Georgia",
          "serif",
        ],
        mono: [
          "var(--font-mono)",
          "JetBrains Mono",
          "ui-monospace",
          "monospace",
        ],
      },

      backgroundColor: {
        bg: tokens.bg,
        "bg-1": tokens.bg1,
        "bg-2": tokens.bg2,
        "bg-3": tokens.bg3,
        accent: tokens.accent,
        "accent-soft": tokens.accentSoft,
        red: tokens.red,
        "red-bg": tokens.redBg,
        amber: tokens.amber,
        "amber-bg": tokens.amberBg,
        green: tokens.green,
        "green-bg": tokens.greenBg,
        gs: tokens.gs,
        "gs-bg": tokens.gsBg,
      },

      borderColor: {
        line: tokens.line,
        "line-2": tokens.line2,
        accent: tokens.accent,
        red: tokens.red,
        amber: tokens.amber,
        green: tokens.green,
        gs: tokens.gs,
      },

      textColor: {
        text: tokens.text,
        "text-dim": tokens.textDim,
        "text-faint": tokens.textFaint,
        accent: tokens.accent,
        red: tokens.red,
        amber: tokens.amber,
        green: tokens.green,
        gs: tokens.gs,
      },

      colors: {
        bg: tokens.bg,
        "bg-1": tokens.bg1,
        "bg-2": tokens.bg2,
        "bg-3": tokens.bg3,
        line: tokens.line,
        "line-2": tokens.line2,
        text: tokens.text,
        "text-dim": tokens.textDim,
        "text-faint": tokens.textFaint,
        accent: tokens.accent,
        "accent-soft": tokens.accentSoft,
        red: tokens.red,
        "red-bg": tokens.redBg,
        amber: tokens.amber,
        "amber-bg": tokens.amberBg,
        green: tokens.green,
        "green-bg": tokens.greenBg,
        gs: tokens.gs,
        "gs-bg": tokens.gsBg,

        // shadcn HSL bridge (used by any leftover components/ui consumers).
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
