import Link from "next/link"

export const dynamic = "force-static"

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col px-6 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">About</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Swarm Public is an agentic intelligence layer for public private
        credit. We turn quarterly BDC filings into a living signal feed.
      </p>

      <section className="mt-10 space-y-4 text-sm leading-7">
        <h2 className="text-xl font-semibold tracking-tight">What we monitor</h2>
        <p>
          Every quarter, publicly traded BDCs file 10-Ks and 10-Qs that disclose
          every position in their private credit portfolio — borrower, fair
          value, cost, accrual status, PIK terms, and more. That's tens of
          thousands of position-level data points per quarter. Most of it goes
          unread.
        </p>
        <p>
          We ingest those filings from SEC EDGAR, parse them into a structured
          observation table, and run a set of detectors that surface
          forward-looking credit signals — fair value drift, PIK creep, and
          cross-fund mark divergence on shared borrowers.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-7">
        <h2 className="text-xl font-semibold tracking-tight">Three detectors</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-medium">Mark Drift Down</span> — fair value
            falls materially while the position is still on accrual. Often the
            first quantitative tell of credit deterioration.
          </li>
          <li>
            <span className="font-medium">PIK Creep</span> — the share of
            interest paid in kind rises across a fund's portfolio, a leading
            indicator of borrower cash-flow stress.
          </li>
          <li>
            <span className="font-medium">Cross-Fund Divergence</span> — multiple
            BDCs hold the same borrower at materially different marks. The
            spread is the disagreement.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-7">
        <h2 className="text-xl font-semibold tracking-tight">Cited to source</h2>
        <p>
          Every alert links back to the exact SEC filing it came from. No black
          boxes, no model hallucinations — the underlying observation is always
          one click away. Each alert is also enriched with a Perplexity research
          pass covering news, litigation, sponsor info, and management changes.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">Get in touch</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          For demos, partnerships, or beta access, sign up for the digest on
          the{" "}
          <Link
            href="/"
            className="text-primary underline-offset-4 hover:underline"
          >
            home page
          </Link>
          .
        </p>
      </section>

      <p className="mt-12 text-xs text-muted-foreground">
        Live data from SEC EDGAR. Not investment advice.
      </p>
    </main>
  )
}
