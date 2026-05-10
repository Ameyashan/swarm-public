/**
 * Reusable skeleton primitives. Use Tailwind animate-pulse on placeholder
 * rectangles. All skeletons should mirror the rough layout of the page they
 * stand in for so transitions feel less jarring.
 */

export function SkeletonBlock({
  className = "",
}: {
  className?: string
}) {
  return (
    <div className={`animate-pulse rounded-md bg-muted/30 ${className}`} />
  )
}

export function SkeletonHeader() {
  return (
    <header className="mb-8 space-y-3">
      <SkeletonBlock className="h-8 w-40" />
      <SkeletonBlock className="h-4 w-72" />
    </header>
  )
}

export function SkeletonStatGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-default bg-card p-4 space-y-2"
        >
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-7 w-32" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-default bg-card">
      <div className="border-b border-default p-3">
        <SkeletonBlock className="h-4 w-48" />
      </div>
      <div className="divide-y divide-default">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid grid-cols-5 gap-3 p-3">
            <SkeletonBlock className="h-4 col-span-1" />
            <SkeletonBlock className="h-4 col-span-2" />
            <SkeletonBlock className="h-4 col-span-1" />
            <SkeletonBlock className="h-4 col-span-1" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkeletonGrid({ items = 6 }: { items?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-default bg-card p-4 space-y-3"
        >
          <SkeletonBlock className="h-4 w-3/4" />
          <SkeletonBlock className="h-20 w-full" />
          <SkeletonBlock className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}
