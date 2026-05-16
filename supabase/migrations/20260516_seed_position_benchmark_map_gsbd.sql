-- Seed: position_benchmark_map for ALL GSBD positions (313 borrowers).
--
-- Phase 3 — auto-mapped via observations.industry_canonical → SPDR sector ETF.
-- PMs can hand-tune tier-1 names later by updating individual rows.
--
-- Idempotent via the primary key. Rerun after a quarterly observations refresh
-- to pick up new positions.

with latest_period as (
  select fund_ticker, portfolio_company_canonical, max(period_end) as period_end
  from public.observations
  where fund_ticker = 'GSBD' and portfolio_company_canonical is not null
  group by fund_ticker, portfolio_company_canonical
),
all_gsbd as (
  select o.fund_ticker, o.portfolio_company_canonical,
         sum(o.fair_value) as fv_total,
         max(coalesce(o.industry_canonical, o.industry, '')) as industry
  from public.observations o
  join latest_period lp using (fund_ticker, portfolio_company_canonical, period_end)
  where o.fair_value is not null
  group by o.fund_ticker, o.portfolio_company_canonical
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
  from all_gsbd
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
