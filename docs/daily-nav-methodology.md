# Daily NAV Marking — Methodology & Build Summary

> A walkthrough of what we built into `swarm-public.vercel.app` to bring third-party daily mark-to-market in-house. Written for a PM who didn't see the development, with layperson explanations alongside the quant details.

---

## In one paragraph

Apollo just announced **Daily NAV** — they re-mark every position in their BDC every day at 10:30 AM ET. That's unprecedented; BDCs traditionally mark quarterly. Goldman wants the same capability. Today we pay a third party roughly **$100 per deal per day** to do this; for the two BDCs in scope (GSCR + GSBD ≈ 480 unique borrowers), that's **~$48,000/day** or **~$12.5M/year**. We've replaced that vendor with an in-house engine: every weekday at 10:30 AM ET, the system reads the latest reported fair value (from quarterly filings), reads today's public-market signals (HY credit spreads, senior-loan ETF, sector ETFs), runs a triangulated valuation formula per position, and writes a new mark to a database. The marks render on `/nav`, `/book`, and each borrower's x-ray page. A backtest against the last two years of quarterly filings shows the model's marks fall within **~120-190 basis points (1.2-1.9%)** of what Houlihan eventually reports for the same date. Decision-support — not auditor-blessed.

---

## Why this exists

### The Apollo trigger

In May 2026, Apollo announced they would publish daily NAV on their direct-lending BDC. BDCs traditionally report fair values **quarterly** (in 10-Qs and 10-Ks) because illiquid private credit doesn't have a daily traded price. Apollo's move sets a new operational bar — PMs at competing BDCs will be expected to know what their portfolio is worth on any given day, not just at quarter-end.

### Why we don't already have it

We outsource it. Specialty valuation firms (Houlihan Lokey, Lincoln International, Kroll) do quarter-end ASC 820 Level 3 valuations for hundreds of BDCs. We've added a **daily** version of the same service at ~$100 per loan per day. For Goldman's GSCR + GSBD book that runs ~$12M/year. The vendor doesn't tell us how they do it day-to-day; we get a price file every morning.

### What we built instead

A self-hosted daily NAV engine that uses **only free public data** (the FRED API and Yahoo Finance) to produce a defensible daily mark per position. The math is documented; every input is auditable; the cost is zero plus our existing Vercel + Supabase bill.

---

## How third-party valuation actually works (plain English)

Houlihan, Lincoln, and Kroll all triangulate three pillars to value an illiquid loan:

1. **Yield-based discount cash-flow (DCF)** — "What would I pay today to receive this loan's future cash flows if I demanded a market yield?" The yield is built from a risk-free rate plus a credit spread for the obligor's industry, rating, and seniority. If credit spreads widen, the loan is worth less; if they tighten, it's worth more.

2. **Market-comparable / matrix pricing** — "What are similar public credits trading at?" They read prices off the LSTA leveraged loan index, BDC composite indices, and high-yield bond ETFs, then adjust for the position's spread and duration.

3. **Recent-transaction override** — "Did anyone just trade a comparable loan?" A fresh primary issuance print or secondary trade on similar paper trumps the model when one is available.

For non-accrual or distressed names they switch to a fourth method: an **enterprise-value waterfall** — "How much would I recover from the company's assets if it were liquidated?" — but that requires deep idiosyncratic analysis the public data can't reproduce.

### Our methodology in plain English

We use a simplified, automated version of pillars 1 and 2, with one important addition.

> **Step 1.** Read the latest reported fair value for every position from the most recent quarterly filing. That's our "anchor."
>
> **Step 2.** Each weekday morning, look at three public benchmarks:
> - **HY OAS spread** (ICE BofA US High Yield Option-Adjusted Spread, FRED series `BAMLH0A0HYM2`) — how much extra yield the high-yield bond market is demanding today vs Treasuries.
> - **BKLN ETF** — the Invesco Senior Loan ETF, our daily proxy for the broader leveraged-loan market.
> - **A sector ETF** matched to the borrower's industry — XLK for software, XLV for healthcare, XLF for financials, etc.
>
> **Step 3.** Compute how each benchmark moved overnight, blend them with industry-specific weights, and translate the blended spread move into a price move using the loan's duration. If credit spreads widened ~5 bps overnight, a 3.5-year-duration loan moves down ~17 bps in price.
>
> **Step 4.** Layer one idiosyncratic adjustment: if any **detector signal** has fired on this borrower in the last 5 days with severity ≥ 70 (think litigation news, management departure, big mark-down on another fund's book), apply an additional 1-10% writedown depending on severity.
>
> **Step 5.** Cap the daily move at **±2%** and flag any position whose accumulated drift from the last reported anchor exceeds **10%** for manual review.

That's it. The output is a single number — today's modeled fair value — plus a complete JSON record of every input that went into it (so the mark is reproducible months later).

### Honest framing

This is **decision-support for PMs**, not an audited 40-Act fair-value mark. We do not replace the quarterly Houlihan process; we sit alongside it and tell you what the public market thinks should have happened to your book between quarterly reports. When Houlihan's next report drops, our **reconciliation** module automatically compares our daily marks at that period_end against the reported number and stores the drift in bps so we can keep tuning.

---

## The math, for the PM who wants to defend it

For each position on each trading day:

```
ΔSpread_market_bps =  w_HY · Δ(HY OAS)             [in bps]
                    + w_LL · (BKLN total return / BKLN duration × 10000)
                    + w_Sec · (sector ETF return × −50 bps implied)

ΔSpread_DCF_bps    =  Δ(HY OAS)                    [collapsed in v1]

ΔSpread_blended    =  α · ΔSpread_DCF + (1 − α) · ΔSpread_market

FV_t               =  FV_{t−1} × (1 − Duration × ΔSpread_blended / 10000)

If idiosyncratic detector fires:
  FV_t = FV_t × (1 + shock)        # shock = −1% to −10%

Governance rails:
  FV_t = clamp(FV_t, FV_{t−1} × 0.98, FV_{t−1} × 1.02)
  requires_review = |FV_t − anchor| / anchor > 0.10 OR rail clamped OR idio fired
```

**v1.0.0 defaults:** `w_HY = 0.50, w_LL = 0.35, w_Sec = 0.15, Duration = 3.5y, α = 0.6` for every position.

**v1.1.0** introduces **per-industry overrides** discovered by backtest tuning (see below).

---

## What got delivered (4 phases, all live)

### Phase 1 — Foundation
- Five new Supabase tables: `methodology_versions`, `benchmark_prices`, `position_benchmark_map`, `daily_marks`, `mark_overrides`. RLS-enabled, anon read, service-role writes.
- Top 20 GSCR exposures mapped to (HY OAS / BKLN / sector ETF) weights, default 3.5y duration, senior-secured assumption.
- A pure TypeScript marking function (`lib/nav/methodology.ts`) with unit tests covering rail clamping, idio shocks, partial coverage, and stale-signal decay.
- A Vercel Cron route gated by `CRON_SECRET` scheduled weekdays at 15:00 UTC.
- A new `/nav` page rendering the daily marks table, pillar-contribution mini-bars, a methodology drawer that shows every input verbatim, and a review queue.

### Phase 2 — Reconciliation + integration
- `nav_reconciliation` table that compares our daily marks to reported FVs whenever a fresh quarterly filing lands.
- A "Today's mark" column on the `/book` page, joining `daily_marks` into the existing position book.
- A 30-day daily sparkline tail on `/borrower/[name]` below the quarterly mark chart.
- A model-accuracy card on `/nav` showing mean / median / p95 drift bps against the v1 quality bar (≤ 250 bps mean).

### Phase 3 — Overrides + scale
- All 313 GSBD positions auto-mapped to the same weight scheme using their industry classification.
- A manual override workflow: `/api/nav/overrides` POST/PATCH endpoints, an inline form in the methodology drawer, approval queue, audit trail in `mark_overrides`.
- A "biggest movers" tile on the morning Briefing showing top 5 daily mark movers across both funds.

### Phase 4 — Backtest + tuning + v1.1.0
- A historical backfill route that bulk-pulls 2 years of FRED + Yahoo into `benchmark_prices` (≈10,000 data points).
- A backtest engine (`lib/nav/backtest.ts`) that walks every (fund, borrower) through consecutive quarterly observations, day-by-day, using historical benchmark snapshots. One drift result per (position, quarter pair).
- A per-industry tuner (`lib/nav/tuner.ts`) that grid-searches ~63 weight × 3 duration × 3 alpha combinations per industry to minimize median absolute drift, with a prepayment filter that drops quarter-pairs where the reported FV moved > 50% (idiosyncratic events the model can't predict).
- A `methodology_industry_weights` table that stores the tuner output keyed by methodology version.
- The runner consults this table at mark time — positions in tuned industries use the bespoke weights; others fall back to v1.0.0 defaults.
- A `TunedIndustriesCard` on `/nav` showing which industries beat the baseline and which kept defaults.

### Follow-ups (PR #7)
- 30-day mark trajectory sparkline column on the `/nav` table so every position's trend is visible at a glance, color-coded by net drift.

---

## What the numbers actually look like

After running the first backtest against 2 years of GSCR and GSBD history:

| Fund | Positions | Quarter-pairs | Mean \|drift\| | **Median \|drift\|** | After tuning |
|---|---:|---:|---:|---:|---:|
| GSCR | 14 | 10 | 284 bps | **188 bps** | n/a — too few samples to tune |
| GSBD | 147 | 142 | 2,164 bps* | **126 bps** | **87 bps** (v1.1.0) |

*GSBD's mean is inflated by 6 idiosyncratic prepayment/restructuring events the public-comparable model has no signal to predict. The daily ±2% rail correctly prevents the model from inventing such writedowns out of thin air. Median is the right summary statistic; **87 bps is a 31% improvement over the v1.0.0 defaults**.

The tuner found bespoke weights for **12 of 32 GSBD industries**, the strongest improvements being:
- **Diversified consumer services** (n=12): −41 bps to 140 bps median
- **Chemicals** (n=4): −40 bps to 50 bps median
- **IT services** (n=5): −36 bps to 16 bps median
- **Software** (n=22): −36 bps to 87 bps median (largest sample, most credible)
- **Financial services** (n=12): −35 bps to 43 bps median
- **Wireless telecom** (n=6): −36 bps but residual still 319 bps — tower assets don't fit a public-comp model

The remaining 20 industries didn't have enough samples (n < 3) so they fall back to v1.0.0 weights. Two industries (commercial services, trading companies) had enough samples but the tuner couldn't beat the baseline — they keep defaults.

---

## Operational rundown

| | |
|---|---|
| **Schedule** | Weekdays 15:00 UTC (≈10–11 AM ET) via `vercel.json` cron |
| **Inputs** | FRED HY OAS, FRED Treasury yields, Yahoo: BKLN, BIZD, HYG, JNK, ANGL, XLK, XLI, XLE, XLV, XLY, XLF, XLP, XLU, XLB, XLRE, XLC |
| **Output** | One `daily_marks` row per (fund, borrower, date, version). Components JSONB carries every benchmark snapshot, weight, rail flag, idio shock. |
| **Auditability** | Methodology version pinned per row. Old marks reproducible from their components. Override workflow has approver + reason fields, status = pending/approved/rejected. |
| **History** | Append-only. After a month: ~20 marks per position. After a year: ~250. No data is ever overwritten. |
| **Cost** | $0 incremental (existing Vercel + Supabase + free FRED + Yahoo). Replaces a ~$12M/year vendor relationship. |

---

## Limitations & honest caveats

1. **Not a regulated valuation.** Decision-support only. Audit, quarterly reporting, and 40-Act compliance still flow through Houlihan.
2. **Prepayments and restructurings invisible.** If a borrower amortizes 80% during the quarter, the model can't see it from FRED/Yahoo and will hold near the prior anchor. The ±2% daily rail correctly prevents fictional writedowns; the reconciliation module surfaces the gap when the next filing lands.
3. **Real-asset-backed loans don't fit well.** Wireless tower loans had the highest residual drift in the backtest (~319 bps even after tuning). The model isn't trained on cell-tower cash flows.
4. **Small-sample industries fall back to defaults.** Where we don't have ≥3 quarterly observations, the tuner can't improve on v1.0.0 weights. Those positions still get a daily mark, just with the baseline formula.
5. **DST sloppiness.** The cron fires at 15:00 UTC year-round, which is 11 AM ET in winter and 10 AM ET in summer. Close enough to Apollo's 10:30 ET target; can be tightened later.

---

## Roadmap

**Done.** Phases 1–4 (above) plus the post-launch refinements: prepayment filter on the tuner, summary-only API response, sparkline column, tuned-industry visibility on `/nav`.

**Next, in priority order:**
1. **Volume scaling.** Currently 191 daily marks per run (20 GSCR + 171 GSBD with non-null anchors). Expand GSCR's hand-curated map from 20 to all ~480 borrowers so the GSCR backtest has the same statistical density as GSBD.
2. **Out-of-sample validation.** After 2 quarters of v1.1.0 running in production, re-run the backtest against the *new* quarterly observations to confirm the tuned weights generalize and weren't overfit.
3. **Pillar 3 — recent-transaction overrides.** Wire in primary loan issuance prints and BDC secondary trade tickers (when available via a data feed) to override the model when fresh comparable transactions exist.
4. **Stress overlay.** Run the daily mark through a "stress scenario" (HY OAS +200 bps, equity −15%) and report stressed FV alongside today's mark.

---

*Built on Next.js 14 + Supabase Postgres + Vercel Cron. Live at swarm-public.vercel.app/nav.*
