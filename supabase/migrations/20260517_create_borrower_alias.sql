-- Borrower → search-term alias mapping for the GDELT headline branch of
-- news-scan. One borrower can have many aliases; news-scan queries GDELT
-- once per alias and dedupes results via news_items (source, source_id).
--
-- Auto-seeded by 20260517_seed_borrower_alias_auto.sql with four passes:
--   1. (dba X)  → alias = X      [the operating brand]
--   2. (aka X)  → alias = X      [also-known-as]
--   3. (fka X)  → alias = X      [formerly-known-as; useful for historical news]
--   4. suffix-stripped fallback  [bare name with corporate + buyer-shell suffixes removed]
--
-- CLO tranches are excluded — they're securitization vehicles, never news targets.

create table if not exists borrower_alias (
  id uuid primary key default gen_random_uuid(),
  portfolio_company_canonical text not null,
  alias text not null,
  source text,
  inserted_at timestamptz not null default now(),
  unique (portfolio_company_canonical, alias)
);

create index if not exists borrower_alias_canonical_idx
  on borrower_alias (portfolio_company_canonical);

alter table borrower_alias enable row level security;
