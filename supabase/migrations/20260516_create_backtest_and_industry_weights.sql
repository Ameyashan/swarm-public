-- Phase 4 schema:
--   backtest_runs               metadata + aggregate stats per backtest invocation
--   backtest_results            per-position-per-quarter drift result (model vs reported)
--   methodology_industry_weights per-industry weight overrides for the v1.1.0 tuner

create table if not exists public.backtest_runs (
  id                       uuid primary key default gen_random_uuid(),
  methodology_version      text not null references public.methodology_versions(version),
  fund_ticker              text not null,
  start_period             date not null,
  end_period               date not null,
  positions_evaluated      integer not null,
  quarter_pairs_evaluated  integer not null,
  mean_abs_drift_bps       numeric,
  median_abs_drift_bps     numeric,
  p95_abs_drift_bps        numeric,
  weights_applied          jsonb,
  notes                    text,
  created_at               timestamptz not null default now()
);

comment on table public.backtest_runs is
  'Backtest invocations — methodology replay against historical observations.';

alter table public.backtest_runs enable row level security;

drop policy if exists "backtest_runs_anon_read" on public.backtest_runs;
create policy "backtest_runs_anon_read"
  on public.backtest_runs for select using (true);

create index if not exists backtest_runs_methodology_idx
  on public.backtest_runs (methodology_version, created_at desc);

create table if not exists public.backtest_results (
  id                          uuid primary key default gen_random_uuid(),
  backtest_run_id             uuid not null references public.backtest_runs(id) on delete cascade,
  fund_ticker                 text not null,
  portfolio_company_canonical text not null,
  industry                    text,
  period_end                  date not null,
  prior_period_end            date not null,
  reported_fv                 numeric not null,
  model_fv                    numeric not null,
  drift_bps                   numeric not null,
  drift_pct                   numeric not null,
  components                  jsonb,
  created_at                  timestamptz not null default now()
);

comment on table public.backtest_results is
  'Per-(position, quarter-pair) drift results inside a backtest run.';

alter table public.backtest_results enable row level security;

drop policy if exists "backtest_results_anon_read" on public.backtest_results;
create policy "backtest_results_anon_read"
  on public.backtest_results for select using (true);

create index if not exists backtest_results_run_idx
  on public.backtest_results (backtest_run_id);
create index if not exists backtest_results_industry_idx
  on public.backtest_results (industry, period_end desc);

-- Per-industry weight + duration overrides for a given methodology_version.
-- Empty rows fall back to position_benchmark_map defaults. Phase 4 tuner
-- writes here under v1.1.0 once it finds drift-minimizing weights.
create table if not exists public.methodology_industry_weights (
  methodology_version  text not null references public.methodology_versions(version),
  industry             text not null,
  w_hy                 numeric not null check (w_hy >= 0 and w_hy <= 1),
  w_ll                 numeric not null check (w_ll >= 0 and w_ll <= 1),
  w_sec                numeric not null check (w_sec >= 0 and w_sec <= 1),
  duration_years       numeric not null check (duration_years >= 0),
  alpha_dcf            numeric not null default 0.6 check (alpha_dcf >= 0 and alpha_dcf <= 1),
  fit_mean_abs_drift_bps numeric,
  sample_size          integer,
  created_at           timestamptz not null default now(),
  primary key (methodology_version, industry)
);

comment on table public.methodology_industry_weights is
  'Per-industry weight overrides keyed by methodology_version. Tuner output.';

alter table public.methodology_industry_weights enable row level security;

drop policy if exists "methodology_industry_weights_anon_read" on public.methodology_industry_weights;
create policy "methodology_industry_weights_anon_read"
  on public.methodology_industry_weights for select using (true);
