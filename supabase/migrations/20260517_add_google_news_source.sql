-- Widen news_items.source to accept Google News RSS as a third feed.
-- Coverage rationale: GDELT misses most private-LBO trade-press headlines;
-- Google News indexes them. Same NewsItem shape, separate source value so
-- the (source, source_id) unique constraint dedupes within-feed only.

alter table news_items drop constraint if exists news_items_source_check;
alter table news_items add constraint news_items_source_check
  check (source in ('edgar_8k', 'headline_feed', 'google_news'));
