-- Migration: Daily NAV marking — schema + RLS + methodology version seed.
-- Apply against Supabase (SQL editor or `supabase db push`) before the
-- `/api/cron/mark-positions` cron route runs.
--
-- Tables introduced:
--   methodology_versions     registry of marking formulas (v1.0.0 seeded below)
--   benchmark_prices         daily snapshots of FRED + Yahoo series
--   position_benchmark_map   per-position weights, duration, seniority, alpha
--   daily_marks              per-position model output per trading date
--   mark_overrides           PM-approved overrides (write-once audit trail)
--
-- All tables are RLS-enabled. Anon role gets SELECT only; writes flow through
-- the service-role admin client invoked by the cron route. The position map
-- is curated via a separate seed SQL file (see same directory).

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- methodology_versions — registry; bump version on any formula change so every
-- daily_marks row pinned to a version remains reproducible.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.methodology_versions (
  version       text primary key,
  effective_at  timestamptz not null,
  formula_doc   text not null,
  notes         text
);

comment on table public.methodology_versions is
  'Daily NAV marking formula registry. Pinned per row in daily_marks.';

alter table public.methodology_versions enable row level security;

drop policy if exists "methodology_versions_anon_read" on public.methodology_versions;
create policy "methodology_versions_anon_read"
  on public.methodology_versions
  for select
  using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_prices — one row per (series_code, as_of_date). Populated daily by
-- the cron route from FRED + Yahoo. Used as inputs to the marking formula.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.benchmark_prices (
  series_code text not null,
  as_of_date  date not null,
  value       numeric not null,
  source      text not null,
  fetched_at  timestamptz not null default now(),
  primary key (series_code, as_of_date)
);

comment on table public.benchmark_prices is
  'Daily snapshots of public benchmarks (FRED OAS series, Yahoo ETF closes).';

alter table public.benchmark_prices enable row level security;

drop policy if exists "benchmark_prices_anon_read" on public.benchmark_prices;
create policy "benchmark_prices_anon_read"
  on public.benchmark_prices
  for select
  using (true);

create index if not exists benchmark_prices_date_idx
  on public.benchmark_prices (as_of_date desc, series_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- position_benchmark_map — how each GSCR/GSBD position maps to public proxies.
-- Hand-curated for Phase 1 top exposures; auto-mapped later via industry.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.position_benchmark_map (
  fund_ticker                 text not null,
  portfolio_company_canonical text not null,
  benchmark_code              text not null,
  weight                      numeric not null check (weight >= 0 and weight <= 1),
  duration_years              numeric not null check (duration_years >= 0),
  seniority                   text,
  alpha_dcf                   numeric not null default 0.6
    check (alpha_dcf >= 0 and alpha_dcf <= 1),
  asof_date                   date not null default current_date,
  primary key (fund_ticker, portfolio_company_canonical, benchmark_code)
);

comment on table public.position_benchmark_map is
  'Per-position weights to public benchmarks + duration + seniority + alpha blend.';

alter table public.position_benchmark_map enable row level security;

drop policy if exists "position_benchmark_map_anon_read" on public.position_benchmark_map;
create policy "position_benchmark_map_anon_read"
  on public.position_benchmark_map
  for select
  using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- daily_marks — model output, one row per (fund, borrower, mark_date, version).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.daily_marks (
  id                          uuid primary key default gen_random_uuid(),
  fund_ticker                 text not null,
  portfolio_company_canonical text not null,
  mark_date                   date not null,
  fair_value_estimated        numeric not null,
  mark_pct                    numeric,
  prior_fv                    numeric,
  delta_bps                   numeric,
  methodology_version         text not null references public.methodology_versions(version),
  components                  jsonb not null,
  confidence                  text not null check (confidence in ('low','med','high')),
  requires_review             boolean not null default false,
  created_at                  timestamptz not null default now(),
  unique (fund_ticker, portfolio_company_canonical, mark_date, methodology_version)
);

comment on table public.daily_marks is
  'Per-position daily NAV marks. components JSONB captures every input used.';

alter table public.daily_marks enable row level security;

drop policy if exists "daily_marks_anon_read" on public.daily_marks;
create policy "daily_marks_anon_read"
  on public.daily_marks
  for select
  using (true);

create index if not exists daily_marks_lookup_idx
  on public.daily_marks (fund_ticker, portfolio_company_canonical, mark_date desc);

create index if not exists daily_marks_date_idx
  on public.daily_marks (mark_date desc);

create index if not exists daily_marks_review_idx
  on public.daily_marks (mark_date desc) where requires_review = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- mark_overrides — write-once audit trail of PM-approved manual overrides.
-- Never mutates daily_marks; the UI joins both and lets the override "win".
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.mark_overrides (
  id                          uuid primary key default gen_random_uuid(),
  fund_ticker                 text not null,
  portfolio_company_canonical text not null,
  override_date               date not null,
  original_mark               numeric not null,
  override_mark               numeric not null,
  reason                      text not null,
  approver                    text,
  status                      text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at                  timestamptz not null default now()
);

comment on table public.mark_overrides is
  'PM-approved manual overrides on daily_marks. Audit-only — never mutates the source.';

alter table public.mark_overrides enable row level security;

drop policy if exists "mark_overrides_anon_read" on public.mark_overrides;
create policy "mark_overrides_anon_read"
  on public.mark_overrides
  for select
  using (true);

create index if not exists mark_overrides_lookup_idx
  on public.mark_overrides (fund_ticker, portfolio_company_canonical, override_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed methodology v1.0.0 (formula doc kept brief here; full spec lives in the
-- repo plan file). Bump version on any change to lib/nav/methodology.ts.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.methodology_versions (version, effective_at, formula_doc, notes)
values (
  'v1.0.0',
  now(),
  $$Daily NAV mark (triangulated, decision-support):
1. Pillar B — market-comparable spread delta (bps) =
     wHY × Δ(HY_OAS_bps) + wLL × BKLN_yield_delta_bps + wSec × sector_yield_delta_bps
   BKLN/sector yield deltas derived from ETF total return / assumed duration.
2. Pillar A — DCF spread delta (bps) from risk-free curve + obligor spread (v1
   collapses to the same duration-adjusted price move; full cash-flow PV in v2).
3. Blend: ΔSpread = α × ΔSpread_dcf + (1−α) × ΔSpread_market   (α default 0.6).
4. Apply: FV_t = FV_{t−1} × (1 − Duration × ΔSpread / 10000).
5. Idiosyncratic overlay: if any detector_hit with severity ≥ 70 fired in last
   5 days, apply −1% to −10% shock proportional to severity.
6. Rails: clamp daily move to ±2%; flag for review if rail fires, idio fired,
   or cumulative drift vs reported anchor > 10%.

This is decision-support, not a 40-Act fair-value mark.$$,
  'Initial production-leaning v1. Phase 1 ships with hand-curated map for top 20 GSCR exposures.'
)
on conflict (version) do nothing;
