-- Second seed batch — verified via SEC EDGAR full-text search. These are
-- active 8-K filers as of 2026-05, either currently public or private LBOs
-- that maintain SEC registration for high-yield bondholders.

insert into borrower_cik (portfolio_company_canonical, cik, source, notes) values
  ('Acrisure, LLC',                  '1515324', 'manual_seed_2026-05', 'Active 10-Q/8-K filer for high-yield notes (Acrisure LLC / Acrisure Finance Inc)'),
  ('Allied Universal Holdco LLC',    '1650520', 'manual_seed_2026-05', 'Files as Allied Universal Topco LLC for bondholders'),
  ('Calpine Corporation',            '916457',  'manual_seed_2026-05', 'Taken private 2018; still files 10-Q/8-K for bondholders'),
  ('Ingram Micro, Inc.',             '1897762', 'manual_seed_2026-05', 'NYSE: INGM (re-IPO Oct 2024 as Ingram Micro Holding Corp)'),
  ('First Advantage Holdings, LLC',  '1210677', 'manual_seed_2026-05', 'NASDAQ: FA (parent First Advantage Corporation)')
on conflict (portfolio_company_canonical) do nothing;
