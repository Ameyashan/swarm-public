import Link from "next/link"
import type { Metadata } from "next"

export const dynamic = "force-static"

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How Swarm Public's three detectors work — mark drift, cross-fund divergence, and PIK creep — including thresholds, math, and edge cases.",
}

export default function MethodologyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col px-6 py-16 sm:py-24">
      <div className="mb-3 text-sm">
        <Link
          href="/"
          className="text-muted underline-offset-4 hover:text-default hover:underline"
        >
          ← Home
        </Link>
      </div>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Methodology
      </h1>
      <p className="mt-4 text-lg text-muted">
        How Swarm Public turns BDC filings into actionable signals. Three
        detectors. All math, all thresholds, all edge cases — explained.
      </p>

      <section className="mt-12 space-y-4 text-sm leading-7">
        <h2 className="text-2xl font-semibold tracking-tight text-default">
          The pipeline
        </h2>
        <p>
          Every quarter, every publicly traded BDC files a 10-Q or 10-K with the
          SEC. We pull each filing the moment it lands on EDGAR, parse the
          schedule of investments table out of the underlying HTML or iXBRL,
          and normalize each row into a single canonical observation: borrower,
          industry, investment type, principal, cost, fair value, accrual
          status, PIK terms, maturity, coupon. We canonicalize borrower names
          across funds so the same private company shows up under one entity
          even when funds spell it differently.
        </p>
        <p>
          That gives us a single fact table — currently 57k+ rows across nine
          funds and thirteen quarters — that the three detectors below run
          against on every new filing.
        </p>
      </section>

      <DetectorSection
        slug="mark-drift-down"
        name="Mark drift down"
        what="A position's fair value drops materially quarter-over-quarter, beyond what the broader credit cycle explains."
        how="We compute the percentage change in fair value between consecutive period_ends for each (fund, borrower) pair. We require the prior-quarter mark to be at least $1M to avoid noise from tiny positions. Severity is the absolute decline as a fraction of prior FV."
        thresholds={[
          {
            tier: "Critical",
            rule: ">50% drop quarter-over-quarter",
          },
          {
            tier: "High",
            rule: "30–50% drop",
          },
          {
            tier: "Medium",
            rule: "10–30% drop",
          },
        ]}
        edgeCases={[
          "Partial repayments at par show up as drops; we cross-reference principal_amount changes to dampen those.",
          "Fund-level mark-downs caused by sector spread widening appear across many positions simultaneously; the heatmap surfaces these as fund-quarter clusters.",
        ]}
      />

      <DetectorSection
        slug="cross-fund-divergence"
        name="Cross-fund divergence"
        what="The same borrower is marked materially differently across two or more BDCs that hold the same instrument."
        how="For each canonical borrower, we group observations by current period_end and compute the spread between max(FV/cost) and min(FV/cost) across funds. We require at least two funds to hold the position at the same period. Severity is the spread in percentage points."
        thresholds={[
          {
            tier: "Critical",
            rule: ">15pp spread between funds on the same borrower",
          },
          {
            tier: "High",
            rule: "8–15pp spread",
          },
          {
            tier: "Medium",
            rule: "3–8pp spread",
          },
        ]}
        edgeCases={[
          "Different tranches of the same borrower (1L vs 2L) often legitimately mark differently; we partition by investment_type before computing the spread.",
          "Quarter-end timing differences can cause spurious divergences for the most recent quarter — we wait for both funds to file before firing.",
        ]}
      />

      <DetectorSection
        slug="pik-creep"
        name="PIK creep"
        what="A fund's FV-weighted share of payment-in-kind income is rising — a leading indicator that borrowers can't pay cash interest."
        how="For each fund and quarter, we compute Σ(FV × is_pik) / Σ(FV) — the share of fair value held in PIK-paying loans. We track this series quarter over quarter per fund. The detector fires when the PIK share rises ≥3 percentage points QoQ or crosses an absolute level."
        thresholds={[
          {
            tier: "Critical",
            rule: "PIK share >25% of FV",
          },
          {
            tier: "High",
            rule: "PIK share crosses 15%, or rises >5pp QoQ",
          },
          {
            tier: "Medium",
            rule: "PIK share >10%, or rises >3pp QoQ",
          },
        ]}
        edgeCases={[
          "Some funds use PIK opportunistically (e.g. during quiet periods) without distress; we surface the level alongside the change to help analysts judge.",
          "PIK toggle loans (cash + PIK) are counted as PIK in this metric. Partial-PIK structures are flagged but don't fire alerts on their own.",
        ]}
      />

      <section className="mt-16 space-y-4 text-sm leading-7">
        <h2 className="text-2xl font-semibold tracking-tight text-default">
          Citations
        </h2>
        <p>
          Every alert links back to (1) the EDGAR filing's primary document URL
          and (2) the schedule-of-investments page within that filing where the
          observation was parsed. If you can't open the source for a hit, it
          shouldn't have fired — file an issue.
        </p>
        <p>
          Universe: ARCC, OBDC, GBDC, MAIN, GSBD, GSCR are live. HTGC, FSK, and
          PSEC are queued for ingestion.
        </p>
      </section>
    </main>
  )
}

function DetectorSection({
  slug,
  name,
  what,
  how,
  thresholds,
  edgeCases,
}: {
  slug: string
  name: string
  what: string
  how: string
  thresholds: { tier: string; rule: string }[]
  edgeCases: string[]
}) {
  return (
    <section
      id={slug}
      className="mt-16 scroll-mt-24 space-y-4 text-sm leading-7"
    >
      <h2 className="text-2xl font-semibold tracking-tight text-default">
        {name}
      </h2>
      <p>
        <span className="font-mono text-xs uppercase tracking-wider text-dim">
          What it catches ·{" "}
        </span>
        {what}
      </p>
      <p>
        <span className="font-mono text-xs uppercase tracking-wider text-dim">
          How it works ·{" "}
        </span>
        {how}
      </p>
      <div className="rounded-lg border border-default bg-card p-4">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-dim">
          Severity tiers
        </div>
        <ul className="space-y-1.5">
          {thresholds.map((t) => (
            <li key={t.tier} className="flex gap-3">
              <span className="w-20 shrink-0 font-mono text-default">
                {t.tier}
              </span>
              <span className="text-muted">{t.rule}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-default/60 bg-card/50 p-4">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-dim">
          Edge cases
        </div>
        <ul className="ml-5 list-disc space-y-1 text-muted">
          {edgeCases.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
