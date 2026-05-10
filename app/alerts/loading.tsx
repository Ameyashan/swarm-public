import {
  SkeletonBlock,
  SkeletonStatGrid,
  SkeletonTable,
} from "@/components/skeletons"

export default function AlertsLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-8 space-y-2">
        <SkeletonBlock className="h-4 w-16" />
        <SkeletonBlock className="h-10 w-48" />
        <SkeletonBlock className="h-4 w-96" />
      </header>
      <SkeletonStatGrid count={4} />
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <SkeletonTable rows={10} />
    </main>
  )
}
