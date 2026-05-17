-- News ingestion for the daily NAV idio signal.
--
-- Two sources feed this table: EDGAR 8-K filings (for borrowers that are SEC
-- filers) and a headline feed (GDELT in v1; swap by changing `source`). The
-- news-scan cron writes here, then the same cron scores each row and inserts
-- into detector_hits with detector_name='news_event'. The daily NAV runner
-- already reads detector_hits within a 5-day window and converts severity
-- into idio_shock_pct, so no runner change is needed.

create table if not exists news_items (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('edgar_8k', 'headline_feed')),
  source_id     text not null,                -- e.g. EDGAR accession #, feed item GUID
  fund_ticker   text,                          -- optional; news may apply across funds
  portfolio_company_canonical text not null,
  published_at  timestamptz not null,
  title         text not null,
  body          text,
  url           text,
  item_codes    text[],                        -- 8-K item numbers, null for headlines
  meta          jsonb not null default '{}'::jsonb,
  inserted_at   timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists news_items_borrower_published_idx
  on news_items (portfolio_company_canonical, published_at desc);

create index if not exists news_items_published_idx
  on news_items (published_at desc);
