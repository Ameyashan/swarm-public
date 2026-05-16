-- Seed: position_benchmark_map for the top 20 GSCR exposures by latest FV.
--
-- One-shot seed; rerun after a quarterly observations refresh to pick up new
-- top exposures. Idempotent via the primary key.
--
-- Methodology:
--   • Pull the latest period_end per (fund, borrower) from observations.
--   • Sum fair_value across all tranches per borrower at that period.
--   • Rank GSCR positions by FV desc, take top 20.
--   • Map each to 3 benchmarks with starting weights: HY OAS 0.50,
--     BKLN 0.35, SPDR sector ETF 0.15.
--   • Default duration 3.5y, seniority 'sr_secured', alpha_dcf 0.6.
--   • Industry → sector ETF resolved via observations.industry_canonical
--     (with fallback to observations.industry, then XLI for unknown).
--
-- All values are starting priors. PMs should tune per-name in Phase 1 review.

with latest_period as (
  select fund_ticker, portfolio_company_canonical,
         max(period_end) as period_end
  from public.observations
  where fund_ticker = 'GSCR'
    and portfolio_company_canonical is not null
  group by fund_ticker, portfolio_company_canonical
),
top20 as (
  select o.fund_ticker, o.portfolio_company_canonical,
         sum(o.fair_value) as fv_total,
         max(coalesce(o.industry_canonical, o.industry, '')) as industry
  from public.observations o
  join latest_period lp
    on  lp.fund_ticker = o.fund_ticker
    and lp.portfolio_company_canonical = o.portfolio_company_canonical
    and lp.period_end = o.period_end
  where o.fair_value is not null
  group by o.fund_ticker, o.portfolio_company_canonical
  order by sum(o.fair_value) desc
  limit 20
),
with_sector as (
  select fund_ticker, portfolio_company_canonical, industry,
         case
           when industry ilike '%software%'        then 'XLK'
           when industry ilike '%technology%'      then 'XLK'
           when industry ilike '%it %'             then 'XLK'
           when industry ilike '%internet%'        then 'XLC'
           when industry ilike '%media%'           then 'XLC'
           when industry ilike '%telecom%'         then 'XLC'
           when industry ilike '%health%'          then 'XLV'
           when industry ilike '%pharma%'          then 'XLV'
           when industry ilike '%biotech%'         then 'XLV'
           when industry ilike '%medical%'         then 'XLV'
           when industry ilike '%energy%'          then 'XLE'
           when industry ilike '%oil%'             then 'XLE'
           when industry ilike '%gas%'             then 'XLE'
           when industry ilike '%bank%'            then 'XLF'
           when industry ilike '%insurance%'       then 'XLF'
           when industry ilike '%financ%'          then 'XLF'
           when industry ilike '%consumer%discr%'  then 'XLY'
           when industry ilike '%retail%'          then 'XLY'
           when industry ilike '%restaurant%'      then 'XLY'
           when industry ilike '%consumer%stap%'   then 'XLP'
           when industry ilike '%food%'            then 'XLP'
           when industry ilike '%utility%'         then 'XLU'
           when industry ilike '%real estate%'     then 'XLRE'
           when industry ilike '%reit%'            then 'XLRE'
           when industry ilike '%material%'        then 'XLB'
           when industry ilike '%chemical%'        then 'XLB'
           else 'XLI'
         end as sector_etf
  from top20
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
