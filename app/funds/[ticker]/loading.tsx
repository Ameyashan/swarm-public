import {
  SkeletonBlock,
  SkeletonStatGrid,
  SkeletonTable,
} from "@/components/skeletons"

export default function FundDetailLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 sm:py-16">
      <SkeletonBlock className="mb-2 h-4 w-16" />
      <SkeletonBlock className="mb-2 h-10 w-56" />
      <SkeletonBlock className="mb-8 h-4 w-96" />
      <SkeletonStatGrid count={3} />
      <SkeletonTable rows={12} />
    </main>
  )
}
