-- nav_reconciliation — persisted model-vs-reported drift per (fund, borrower, period_end).
-- Computed after a new observations row lands and the model has at least one
-- daily_marks row at or before that period_end. Lets us show a "model accuracy"
-- card on /nav and tune weights in Phase 4.

create table if not exists public.nav_reconciliation (
  id                          uuid primary key default gen_random_uuid(),
  fund_ticker                 text not null,
  portfolio_company_canonical text not null,
  period_end                  date not null,
  reported_fv                 numeric not null,
  model_fv                    numeric not null,
  model_mark_date             date not null,
  drift_bps                   numeric not null,
  drift_pct                   numeric not null,
  methodology_version         text not null references public.methodology_versions(version),
  created_at                  timestamptz not null default now(),
  unique (fund_ticker, portfolio_company_canonical, period_end, methodology_version)
);

comment on table public.nav_reconciliation is
  'Trailing model-vs-reported drift. Computed when a new observations row lands.';

alter table public.nav_reconciliation enable row level security;

drop policy if exists "nav_reconciliation_anon_read" on public.nav_reconciliation;
create policy "nav_reconciliation_anon_read"
  on public.nav_reconciliation
  for select
  using (true);

create index if not exists nav_reconciliation_fund_idx
  on public.nav_reconciliation (fund_ticker, period_end desc);

create index if not exists nav_reconciliation_methodology_idx
  on public.nav_reconciliation (methodology_version, period_end desc);
