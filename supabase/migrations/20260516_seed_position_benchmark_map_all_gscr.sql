-- Phase 5 — expand GSCR coverage from 20 hand-curated top exposures to all 467
-- non-null-FV borrowers, mirroring the GSBD auto-mapping from Phase 3.
--
-- Idempotent via the primary key. Existing top-20 hand-curated rows keep their
-- (identical) weights; new rows fill in the remaining 447 GSCR borrowers.
--
-- Industry → SPDR sector ETF resolved via observations.industry_canonical with
-- fallback to observations.industry, then XLI for anything unmatched.
-- Starting priors: HY OAS 0.50 / BKLN 0.35 / sector ETF 0.15, duration 3.5y,
-- seniority 'sr_secured', alpha_dcf 0.6. The Phase 4 tuner overrides per
-- industry where it found drift-minimizing weights.

with latest_period as (
  select fund_ticker, portfolio_company_canonical, max(period_end) as period_end
  from public.observations
  where fund_ticker = 'GSCR' and portfolio_company_canonical is not null
  group by fund_ticker, portfolio_company_canonical
),
all_gscr as (
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
  from all_gscr
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
