-- Migration: saved_patterns table for the /patterns composer.
-- Apply manually against the Supabase project (SQL editor or `supabase db push`)
-- before the "Save as pattern" button on /patterns will succeed.
--
-- Schema requirements (from Commit 5 contract):
--   id          uuid    default gen_random_uuid() PRIMARY KEY
--   created_at  timestamptz default now()
--   label       text    -- short user-facing pattern title
--   query       text    -- original natural-language query
--   filters     jsonb   -- the structured PatternFilters JSON
--   fund_scope  text    -- optional "GSCR+GSBD" / "ALL" tag
-- Read-only for the anon role; insert allowed via permissive RLS policy.

create extension if not exists pgcrypto;

create table if not exists public.saved_patterns (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  label       text not null,
  query       text,
  filters     jsonb not null default '{}'::jsonb,
  fund_scope  text
);

comment on table public.saved_patterns is
  'Saved cross-borrower pattern queries created from the /patterns composer.';

alter table public.saved_patterns enable row level security;

-- v1: allow anonymous read + insert (no auth surface in the app yet). Tighten
-- once Supabase Auth is wired up.
drop policy if exists "saved_patterns_anon_read" on public.saved_patterns;
create policy "saved_patterns_anon_read"
  on public.saved_patterns
  for select
  using (true);

drop policy if exists "saved_patterns_anon_insert" on public.saved_patterns;
create policy "saved_patterns_anon_insert"
  on public.saved_patterns
  for insert
  with check (true);

create index if not exists saved_patterns_created_at_idx
  on public.saved_patterns (created_at desc);
