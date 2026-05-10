// Centralized design tokens for the Swarm Public app.
// Keep this file in sync with tailwind.config.ts (semantic color names) and
// app/globals.css (CSS variables consumed by shadcn/ui).

export const colors = {
  bg: '#0A0E1A',
  bgElevated: '#111827',
  bgCard: '#0F1623',
  border: '#1F2937',
  borderHover: '#374151',
  text: '#F3F4F6',
  textMuted: '#9CA3AF',
  textDim: '#6B7280',
  accent: '#3B82F6',
  accentDim: '#1E3A8A',

  severity: {
    critical: '#EF4444', // >50%
    high: '#F59E0B',     // 30-50%
    medium: '#FBBF24',   // 10-30%
    low: '#6B7280',      // <10%
  },

  status: {
    accrual: '#10B981',
    nonAccrual: '#EF4444',
    pik: '#F59E0B',
  },
} as const;

export const motion = {
  spring: { type: 'spring', stiffness: 200, damping: 25 },
  smooth: { duration: 0.4, ease: [0.32, 0.72, 0, 1] },
  fast: { duration: 0.2, ease: 'easeOut' },
} as const;

export type SeverityLevel = keyof typeof colors.severity;
export type StatusLevel = keyof typeof colors.status;

/** Bucket a percentage drop into a severity level. */
export function severityFor(pct: number): SeverityLevel {
  const abs = Math.abs(pct);
  if (abs > 50) return 'critical';
  if (abs >= 30) return 'high';
  if (abs >= 10) return 'medium';
  return 'low';
}
