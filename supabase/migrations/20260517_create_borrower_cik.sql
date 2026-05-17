-- Borrower → SEC CIK mapping for the EDGAR 8-K branch of news-scan.
--
-- Most direct private-credit borrowers are NOT SEC filers (the BDC itself is,
-- but its portfolio companies usually aren't). Rows exist only for borrowers
-- where someone has manually verified the CIK. Empty table is the normal
-- starting state; the EDGAR fetcher returns 0 items until rows are added.

create table if not exists borrower_cik (
  portfolio_company_canonical text primary key,
  cik                         text not null check (cik ~ '^[0-9]{1,10}$'),
  source                      text,         -- 'manual' / 'lookup_2026-05'
  notes                       text,
  inserted_at                 timestamptz not null default now()
);

create index if not exists borrower_cik_cik_idx on borrower_cik (cik);
