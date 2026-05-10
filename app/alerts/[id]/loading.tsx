import { SkeletonBlock, SkeletonTable } from "@/components/skeletons"

export default function AlertDetailLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-12 sm:py-16">
      <SkeletonBlock className="mb-2 h-4 w-24" />
      <SkeletonBlock className="mb-2 h-10 w-3/4" />
      <SkeletonBlock className="mb-8 h-4 w-1/2" />
      <SkeletonBlock className="mb-6 h-32 w-full rounded-lg" />
      <SkeletonBlock className="mb-6 h-64 w-full rounded-lg" />
      <SkeletonTable rows={6} />
    </main>
  )
}
