import type { Config } from "tailwindcss";

// Raw design tokens — keep these in lockstep with lib/design-tokens.ts.
const tokens = {
  bg: "#0A0E1A",
  bgElevated: "#111827",
  bgCard: "#0F1623",
  border: "#1F2937",
  borderHover: "#374151",
  text: "#F3F4F6",
  textMuted: "#9CA3AF",
  textDim: "#6B7280",
  accent: "#3B82F6",
  accentDim: "#1E3A8A",
  severityCritical: "#EF4444",
  severityHigh: "#F59E0B",
  severityMedium: "#FBBF24",
  severityLow: "#6B7280",
  statusAccrual: "#10B981",
  statusNonAccrual: "#EF4444",
  statusPik: "#F59E0B",
  // Editorial briefing palette (semantic — keep strict per spec).
  // terracotta = editorial accent / headline block / primary editorial affordance
  // gsGold     = Goldman identity / GSCR + GSBD markers / ★ glyphs
  // brickRed   = critical severity only (sev >= 70)
  // mustard    = watch signal only (sev 40-70 / elevated PIK)
  // sage       = healthy / positive credit signal only
  terracotta: "#D97757",
  terracottaSoft: "rgba(217, 119, 87, 0.10)",
  gsGold: "#D4A857",
  gsGoldSoft: "rgba(212, 168, 87, 0.10)",
  brickRed: "#E5564B",
  brickRedSoft: "rgba(229, 86, 75, 0.10)",
  mustard: "#E0B341",
  mustardSoft: "rgba(224, 179, 65, 0.10)",
  sage: "#8FBF8E",
  sageSoft: "rgba(143, 191, 142, 0.10)",
};

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
          "Source Serif 4",
          "Source Serif Pro",
          "Georgia",
          "serif",
        ],
      },

      // Semantic background-color utilities: bg-surface, bg-elevated, bg-card
      backgroundColor: {
        surface: tokens.bg,
        elevated: tokens.bgElevated,
        card: tokens.bgCard,
        accent: tokens.accent,
        "accent-dim": tokens.accentDim,
        "severity-critical": tokens.severityCritical,
        "severity-high": tokens.severityHigh,
        "severity-medium": tokens.severityMedium,
        "severity-low": tokens.severityLow,
        "status-accrual": tokens.statusAccrual,
        "status-non-accrual": tokens.statusNonAccrual,
        "status-pik": tokens.statusPik,
        // Editorial briefing palette
        terracotta: tokens.terracotta,
        "terracotta-soft": tokens.terracottaSoft,
        "gs-gold": tokens.gsGold,
        "gs-gold-soft": tokens.gsGoldSoft,
        "brick-red": tokens.brickRed,
        "brick-red-soft": tokens.brickRedSoft,
        mustard: tokens.mustard,
        "mustard-soft": tokens.mustardSoft,
        sage: tokens.sage,
        "sage-soft": tokens.sageSoft,
      },

      // Semantic border-color utilities: border-default, border-hover
      borderColor: {
        default: tokens.border,
        hover: tokens.borderHover,
        accent: tokens.accent,
        "severity-critical": tokens.severityCritical,
        "severity-high": tokens.severityHigh,
        "severity-medium": tokens.severityMedium,
        "severity-low": tokens.severityLow,
        terracotta: tokens.terracotta,
        "gs-gold": tokens.gsGold,
        "brick-red": tokens.brickRed,
        mustard: tokens.mustard,
        sage: tokens.sage,
      },

      // Semantic text-color utilities: text-default, text-muted, text-dim
      textColor: {
        default: tokens.text,
        muted: tokens.textMuted,
        dim: tokens.textDim,
        accent: tokens.accent,
        "severity-critical": tokens.severityCritical,
        "severity-high": tokens.severityHigh,
        "severity-medium": tokens.severityMedium,
        "severity-low": tokens.severityLow,
        "status-accrual": tokens.statusAccrual,
        "status-non-accrual": tokens.statusNonAccrual,
        "status-pik": tokens.statusPik,
        terracotta: tokens.terracotta,
        "gs-gold": tokens.gsGold,
        "brick-red": tokens.brickRed,
        mustard: tokens.mustard,
        sage: tokens.sage,
      },

      // General colors (covers ring-, fill-, stroke-, etc., plus shadcn vars).
      colors: {
        // Convenience: also expose semantic names here for non bg/border/text
        // utilities (ring, divide, fill, etc.).
        surface: tokens.bg,
        elevated: tokens.bgElevated,
        accent: {
          DEFAULT: tokens.accent,
          dim: tokens.accentDim,
          foreground: "hsl(var(--accent-foreground))",
        },
        severity: {
          critical: tokens.severityCritical,
          high: tokens.severityHigh,
          medium: tokens.severityMedium,
          low: tokens.severityLow,
        },
        status: {
          accrual: tokens.statusAccrual,
          "non-accrual": tokens.statusNonAccrual,
          pik: tokens.statusPik,
        },
        terracotta: tokens.terracotta,
        "terracotta-soft": tokens.terracottaSoft,
        "gs-gold": tokens.gsGold,
        "gs-gold-soft": tokens.gsGoldSoft,
        "brick-red": tokens.brickRed,
        "brick-red-soft": tokens.brickRedSoft,
        mustard: tokens.mustard,
        "mustard-soft": tokens.mustardSoft,
        sage: tokens.sage,
        "sage-soft": tokens.sageSoft,

        // shadcn/ui CSS-variable tokens (kept for existing components).
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
          DEFAULT: tokens.bgCard,
          foreground: "hsl(var(--card-foreground))",
        },
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
