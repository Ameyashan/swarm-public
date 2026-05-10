import {
  SkeletonBlock,
  SkeletonStatGrid,
  SkeletonTable,
} from "@/components/skeletons"

export default function WatchLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 sm:py-16">
      <SkeletonBlock className="mb-2 h-4 w-24" />
      <SkeletonBlock className="mb-2 h-10 w-3/4" />
      <SkeletonBlock className="mb-8 h-4 w-1/2" />
      <SkeletonStatGrid count={4} />
      <div className="mb-6 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-9 w-24 rounded-md" />
        ))}
      </div>
      <SkeletonBlock className="mb-6 h-72 w-full rounded-lg" />
      <SkeletonTable rows={8} />
    </main>
  )
}
