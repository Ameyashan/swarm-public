import { SkeletonBlock, SkeletonTable } from "@/components/skeletons"

export default function FundsLoading() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-4xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-8 space-y-2">
        <SkeletonBlock className="h-10 w-40" />
        <SkeletonBlock className="h-4 w-72" />
      </header>
      <SkeletonTable rows={6} />
    </main>
  )
}
