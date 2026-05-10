import {
  SkeletonBlock,
  SkeletonStatGrid,
  SkeletonTable,
} from "@/components/skeletons"

export default function DriftLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-6 space-y-2">
        <SkeletonBlock className="h-4 w-16" />
        <SkeletonBlock className="h-10 w-56" />
        <SkeletonBlock className="h-4 w-96" />
      </header>
      <SkeletonStatGrid count={4} />
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-8 w-20 rounded-md" />
        ))}
      </div>
      <SkeletonTable rows={12} />
    </main>
  )
}
