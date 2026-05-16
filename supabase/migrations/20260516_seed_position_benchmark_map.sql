-- Seed: position_benchmark_map for the top 20 GSCR exposures by latest FV.
--
-- This is a one-shot seed; rerun after a quarterly observations refresh to
-- pick up new top exposures. Idempotent via the primary key.
--
-- Methodology:
--   • Pull the latest period_end per (fund, borrower) from observations.
--   • Rank GSCR positions by fair_value desc, take top 20.
--   • Map each to 3 benchmarks with starting weights: HY OAS 0.50,
--     BKLN 0.35, SPDR sector ETF 0.15.
--   • Default duration 3.5y, seniority 'sr_secured', alpha_dcf 0.6.
--   • Industry → sector ETF resolved via borrower_canonical.industry.
--
-- All values are starting priors. PMs should tune per-name in Phase 1 review.

with latest_period as (
  select fund_ticker, portfolio_company_canonical,
         max(period_end) as period_end
  from public.observations
  where fund_ticker = 'GSCR'
  group by fund_ticker, portfolio_company_canonical
),
top20 as (
  select o.fund_ticker, o.portfolio_company_canonical, o.fair_value
  from public.observations o
  join latest_period lp
    on  lp.fund_ticker = o.fund_ticker
    and lp.portfolio_company_canonical = o.portfolio_company_canonical
    and lp.period_end = o.period_end
  where o.fair_value is not null
  order by o.fair_value desc
  limit 20
),
with_industry as (
  select t.fund_ticker, t.portfolio_company_canonical,
         coalesce(bc.industry, '') as industry
  from top20 t
  left join public.borrower_canonical bc
    on bc.canonical_name = t.portfolio_company_canonical
),
-- Map industry → SPDR sector ETF. Falls back to XLI (industrials) when unknown.
with_sector as (
  select fund_ticker, portfolio_company_canonical, industry,
         case
           when industry ilike '%software%'      then 'XLK'
           when industry ilike '%technology%'    then 'XLK'
           when industry ilike '%it %'           then 'XLK'
           when industry ilike '%internet%'      then 'XLC'
           when industry ilike '%media%'         then 'XLC'
           when industry ilike '%telecom%'       then 'XLC'
           when industry ilike '%health%'        then 'XLV'
           when industry ilike '%pharma%'        then 'XLV'
           when industry ilike '%biotech%'       then 'XLV'
           when industry ilike '%medical%'       then 'XLV'
           when industry ilike '%energy%'        then 'XLE'
           when industry ilike '%oil%'           then 'XLE'
           when industry ilike '%gas%'           then 'XLE'
           when industry ilike '%bank%'          then 'XLF'
           when industry ilike '%insurance%'     then 'XLF'
           when industry ilike '%financ%'        then 'XLF'
           when industry ilike '%consumer%discr%' then 'XLY'
           when industry ilike '%retail%'        then 'XLY'
           when industry ilike '%restaurant%'    then 'XLY'
           when industry ilike '%consumer%stap%' then 'XLP'
           when industry ilike '%food%'          then 'XLP'
           when industry ilike '%utility%'       then 'XLU'
           when industry ilike '%real estate%'   then 'XLRE'
           when industry ilike '%reit%'          then 'XLRE'
           when industry ilike '%material%'      then 'XLB'
           when industry ilike '%chemical%'      then 'XLB'
           else 'XLI'
         end as sector_etf
  from with_industry
)
insert into public.position_benchmark_map
  (fund_ticker, portfolio_company_canonical, benchmark_code, weight,
   duration_years, seniority, alpha_dcf)
select fund_ticker, portfolio_company_canonical, b.code, b.w, 3.5, 'sr_secured', 0.6
from with_sector
cross join lateral (values
  ('BAMLH0A0HYM2'::text, 0.50::numeric),
  ('BKLN'::text,         0.35::numeric),
  (sector_etf,           0.15::numeric)
) as b(code, w)
on conflict (fund_ticker, portfolio_company_canonical, benchmark_code)
do nothing;
