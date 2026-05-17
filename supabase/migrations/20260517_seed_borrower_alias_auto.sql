-- Auto-seed borrower_alias from position_benchmark_map canonical names.
-- Four passes: dba/aka/fka extraction + suffix-stripped fallback.

-- Pass 1: extract every "(dba X)" alias, case-insensitive.
with universe as (
  select distinct portfolio_company_canonical
  from position_benchmark_map
  where fund_ticker in ('GSCR','GSBD')
)
insert into borrower_alias (portfolio_company_canonical, alias, source)
select u.portfolio_company_canonical, trim(m[1]), 'dba_extracted'
from universe u,
     regexp_matches(u.portfolio_company_canonical, '\(dba\s+([^)]+)\)', 'gi') as m
where length(trim(m[1])) >= 3
on conflict do nothing;

-- Pass 2: aka
with universe as (
  select distinct portfolio_company_canonical
  from position_benchmark_map
  where fund_ticker in ('GSCR','GSBD')
)
insert into borrower_alias (portfolio_company_canonical, alias, source)
select u.portfolio_company_canonical, trim(m[1]), 'aka_extracted'
from universe u,
     regexp_matches(u.portfolio_company_canonical, '\(aka\s+([^)]+)\)', 'gi') as m
where length(trim(m[1])) >= 3
on conflict do nothing;

-- Pass 3: fka
with universe as (
  select distinct portfolio_company_canonical
  from position_benchmark_map
  where fund_ticker in ('GSCR','GSBD')
)
insert into borrower_alias (portfolio_company_canonical, alias, source)
select u.portfolio_company_canonical, trim(m[1]), 'fka_extracted'
from universe u,
     regexp_matches(u.portfolio_company_canonical, '\(fka\s+([^)]+)\)', 'gi') as m
where length(trim(m[1])) >= 3
on conflict do nothing;

-- Pass 4: suffix-stripped fallback for borrowers without a dba/aka/fka.
-- Excludes CLO/Class-tranche securitization vehicles (never news targets).
-- Strips corporate suffixes plus buyer-shell suffixes (BidCo, Buyer, TopCo,
-- MidCo, NewCo, Intermediate, Parent, Acquisition, Merger Sub, Borrower,
-- Issuer, FinanceCo, Finco, PikCo). Cleans up orphan ", ." artifacts.
with universe as (
  select distinct portfolio_company_canonical
  from position_benchmark_map
  where fund_ticker in ('GSCR','GSBD')
), need_fallback as (
  select u.portfolio_company_canonical
  from universe u
  left join borrower_alias a using (portfolio_company_canonical)
  where a.id is null
    and u.portfolio_company_canonical not ilike '%CLO%'
    and u.portfolio_company_canonical not ilike '%Class A%'
    and u.portfolio_company_canonical not ilike '%Class B%'
    and u.portfolio_company_canonical not ilike '%Class C%'
    and u.portfolio_company_canonical not ilike '%Class D%'
    and u.portfolio_company_canonical not ilike '%Class E%'
), stripped as (
  select
    portfolio_company_canonical,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(portfolio_company_canonical, '\([^)]*\)', '', 'g'),
          '\m(Inc\.?|LLC|L\.L\.C\.?|LLP|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|Limited|Holdings?|Holdco|Group|Partners?|LP|L\.P\.?|Plc|PLC|N\.A\.?|S\.A\.?|S\.\.r\.l\.?|S\.a\.r\.l\.?|GmbH|AG|AB|B\.V\.?|Pty|BidCo|Bidco|TopCo|Topco|MidCo|Midco|NewCo|Newco|Intermediate|Parent|Acquireco|AcquisitionCo|Acquisition|Buyer|Merger Sub|Borrower|Issuer|FinanceCo|Finco|PikCo)\M',
          '', 'gi'),
        ',\s*\.?', ' ', 'g'),
      '\s+', ' ', 'g')
    as alias
  from need_fallback
)
insert into borrower_alias (portfolio_company_canonical, alias, source)
select portfolio_company_canonical,
       trim(both ' ,.-' from alias),
       'suffix_stripped'
from stripped
where length(trim(both ' ,.-' from alias)) >= 3
on conflict do nothing;
