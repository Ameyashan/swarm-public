import {
  SkeletonBlock,
  SkeletonStatGrid,
} from "@/components/skeletons"

export default function HeatmapLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-8 space-y-2">
        <SkeletonBlock className="h-4 w-16" />
        <SkeletonBlock className="h-10 w-40" />
        <SkeletonBlock className="h-4 w-3/4 max-w-xl" />
      </header>
      <SkeletonStatGrid count={4} />
      <div className="overflow-hidden rounded-xl border border-default bg-card p-4">
        <div className="grid grid-cols-13 gap-2">
          {Array.from({ length: 13 * 7 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-12" />
          ))}
        </div>
      </div>
    </main>
  )
}
