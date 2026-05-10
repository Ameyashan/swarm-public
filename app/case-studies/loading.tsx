import { SkeletonBlock, SkeletonGrid } from "@/components/skeletons"

export default function CaseStudiesLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 sm:py-16">
      <header className="mb-8 space-y-2">
        <SkeletonBlock className="h-10 w-56" />
        <SkeletonBlock className="h-4 w-96" />
      </header>
      <SkeletonGrid items={6} />
    </main>
  )
}
