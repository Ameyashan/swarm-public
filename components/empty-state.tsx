import { ReactNode } from "react"

type Props = {
  title: string
  description?: string
  action?: ReactNode
  /** Optional icon element (defaults to a stylized SVG dot grid). */
  icon?: ReactNode
}

/**
 * Friendly empty-state placeholder for filtered views with no results.
 * Uses a subtle illustration + clear copy + optional action.
 */
export function EmptyState({ title, description, action, icon }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center justify-center rounded-xl border border-dashed border-default bg-card/50 px-8 py-16 text-center">
      <div className="mb-5 text-muted">
        {icon ?? <DefaultIllustration />}
      </div>
      <h3 className="text-lg font-semibold text-default">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

function DefaultIllustration() {
  // Minimal radar-pulse illustration to fit the "monitoring" theme.
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="40" cy="40" r="34" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <circle cx="40" cy="40" r="22" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="3 3" />
      <circle cx="40" cy="40" r="10" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" />
      <circle cx="40" cy="40" r="2.5" fill="currentColor" fillOpacity="0.7" />
      <line x1="40" y1="40" x2="62" y2="22" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
