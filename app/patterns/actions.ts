"use server"

import { createClient } from "@/lib/supabase/server"
import { parsePatternQuery, parsePatternQueryHeuristic } from "@/lib/patterns/parse"
import {
  validateParsedQuery,
  type PatternFilters,
  type ParsedQuery,
} from "@/lib/patterns/schema"

// ─────────────────────────────────────────────────────────────────────────────
// Server actions for the /patterns composer.
// All Anthropic API calls happen server-side; the API key is never sent to
// the browser.
// ─────────────────────────────────────────────────────────────────────────────

export type ParseActionResult =
  | { ok: true; query: string; parsed: ParsedQuery; elapsedMs: number }
  | { ok: false; error: string }

export async function parseAction(query: string): Promise<ParseActionResult> {
  if (typeof query !== "string") {
    return { ok: false, error: "Invalid query payload." }
  }
  const trimmed = query.trim()
  if (!trimmed) {
    return { ok: false, error: "Enter a question first." }
  }
  if (trimmed.length > 600) {
    return { ok: false, error: "Query too long (max 600 chars)." }
  }
  // When ANTHROPIC_API_KEY isn't configured, fall back to the deterministic
  // regex parser. Keeps the composer usable in environments (e.g. the
  // public Vercel preview) where the key hasn't been provisioned.
  const result = process.env.ANTHROPIC_API_KEY
    ? await parsePatternQuery(trimmed)
    : parsePatternQueryHeuristic(trimmed)
  if (!result.ok) return result
  return { ok: true, query: trimmed, parsed: result.parsed, elapsedMs: result.elapsedMs }
}

export type SaveActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function savePatternAction(payload: {
  label: string
  query: string
  filters: unknown
}): Promise<SaveActionResult> {
  const supabase = createClient()
  const label = (payload?.label ?? "").toString().trim().slice(0, 200) || "Untitled pattern"
  const queryText = (payload?.query ?? "").toString().trim().slice(0, 600)
  const parsed = validateParsedQuery(payload?.filters)
  const filters: PatternFilters = parsed.filters

  const fund_scope = filters.funds
    ? filters.funds.join("+")
    : "ALL"

  const { data, error } = await supabase
    .from("saved_patterns")
    .insert({
      label,
      query: queryText,
      filters: filters as unknown as Record<string, unknown>,
      fund_scope,
    })
    .select("id")
    .single()
  if (error) {
    return {
      ok: false,
      error: `Could not save pattern: ${error.message}. Ensure the saved_patterns table exists (see supabase/migrations/20260511_create_saved_patterns.sql).`,
    }
  }
  return { ok: true, id: (data as { id: string }).id }
}
