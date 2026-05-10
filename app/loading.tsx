import {
  SkeletonBlock,
  SkeletonStatGrid,
  SkeletonTable,
} from "@/components/skeletons"

export default function HomeLoading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-12 sm:py-16">
      <section className="flex flex-col items-start gap-4">
        <SkeletonBlock className="h-6 w-32" />
        <SkeletonBlock className="h-12 w-full max-w-3xl" />
        <SkeletonBlock className="h-5 w-2/3 max-w-xl" />
        <div className="mt-4 w-full">
          <SkeletonStatGrid count={3} />
        </div>
      </section>
      <section>
        <SkeletonBlock className="mb-3 h-3 w-40" />
        <SkeletonBlock className="h-14 w-full rounded-xl" />
      </section>
      <section>
        <SkeletonBlock className="mb-3 h-3 w-40" />
        <SkeletonTable rows={6} />
      </section>
    </main>
  )
}
