-- Initial CIK seed for the obvious SEC-filer borrowers in the GSCR/GSBD
-- universe. All entries are current US public filers (10-Q/8-K active). Names
-- match position_benchmark_map.portfolio_company_canonical exactly. CIKs are
-- left-padded to 10 digits at query time by lib/nav/edgar.ts; we store the
-- canonical integer form.
--
-- Add more as you verify them. EDGAR full-text search by company name is the
-- easiest validation path: https://efts.sec.gov/LATEST/search-index?q=%22NAME%22

insert into borrower_cik (portfolio_company_canonical, cik, source, notes) values
  ('Atkore International, Inc.',                                  '1666138', 'manual_seed_2026-05', 'NYSE: ATKR'),
  ('Nvent Electric Public Limited Company',                       '1720635', 'manual_seed_2026-05', 'NYSE: NVT'),
  ('Reynolds Consumer Products LLC',                              '1786189', 'manual_seed_2026-05', 'NASDAQ: REYN (parent Reynolds Consumer Products Inc.)'),
  ('Getty Images, Inc.',                                          '1898437', 'manual_seed_2026-05', 'NYSE: GETY (parent Getty Images Holdings Inc.)'),
  ('E2open, LLC',                                                 '1822928', 'manual_seed_2026-05', 'NYSE: ETWO (parent e2open Parent Holdings Inc.)'),
  ('Integral Ad Science, Inc.',                                   '1842359', 'manual_seed_2026-05', 'NASDAQ: IAS (Integral Ad Science Holding Corp.)'),
  ('SelectQuote, Inc.',                                           '1794515', 'manual_seed_2026-05', 'NYSE: SLQT'),
  ('Rubrik, Inc.',                                                '1943896', 'manual_seed_2026-05', 'NYSE: RBRK'),
  ('Newtek Merchant Solutions, LLC (dba NewtekOne)',              '1587987', 'manual_seed_2026-05', 'NASDAQ: NEWT (parent NewtekOne Inc.)'),
  ('Priority Technology Holdings, Inc. (dba Priority Payment)',   '1653558', 'manual_seed_2026-05', 'NASDAQ: PRTH')
on conflict (portfolio_company_canonical) do nothing;
