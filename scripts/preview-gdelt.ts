#!/usr/bin/env node
// Preview GDELT signal-to-noise for the borrower_alias seed.
//
// Hits GDELT once per alias (no DB writes), classifies each hit with the same
// rules news-scan uses, and prints a per-alias summary plus a "noisiest
// aliases" leaderboard. Use the output to decide whether to invest in the LLM
// enrichment pass (option b) or to manually curate the worst offenders.
//
// Run:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/preview-gdelt.ts [--timespan 7d] [--max-aliases 200]
//
// Reads .env.local automatically if present.

import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  classifyByRules,
  shouldLlmClassify,
  type NewsItem,
} from "../lib/nav/news.ts"
import { searchGdelt, gdeltDateToIso } from "../lib/nav/gdelt.ts"

// ─── env loading (minimal .env.local parser) ──────────────────────────────
const envPath = join(process.cwd(), ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env or .env.local")
  process.exit(1)
}

// ─── args ─────────────────────────────────────────────────────────────────
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const TIMESPAN = arg("timespan", "7d")
const MAX_ALIASES = Number(arg("max-aliases", "0")) || Infinity
const MAX_RECORDS = Number(arg("max-records", "10"))

// ─── load aliases ─────────────────────────────────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
const { data: aliasRows, error } = await sb
  .from("borrower_alias")
  .select("portfolio_company_canonical, alias, source")
if (error) {
  console.error("supabase load failed:", error.message)
  process.exit(1)
}
const aliases = (aliasRows ?? []).slice(0, MAX_ALIASES) as Array<{
  portfolio_company_canonical: string
  alias: string
  source: string
}>
console.error(`loaded ${aliases.length} aliases · timespan=${TIMESPAN} · max-records=${MAX_RECORDS}`)

// ─── walk + classify ──────────────────────────────────────────────────────
type AliasStat = {
  canonical: string
  alias: string
  source: string
  hits: number
  rule_matches: number
  llm_candidates: number
  noise: number
  samples: string[]
}
const stats: AliasStat[] = []
let done = 0
const t0 = Date.now()

for (const row of aliases) {
  const articles = await searchGdelt(row.alias, TIMESPAN, MAX_RECORDS).catch((e) => {
    console.error(`gdelt error for "${row.alias}": ${e instanceof Error ? e.message : e}`)
    return []
  })
  let rule = 0, llm = 0, noise = 0
  const samples: string[] = []
  for (const a of articles) {
    // For classification, set portfolio_company_canonical = alias so the
    // shouldLlmClassify name-check matches what GDELT actually searched for.
    // We keep the real canonical for reporting below.
    const item: NewsItem = {
      source: "headline_feed",
      source_id: a.url,
      portfolio_company_canonical: row.alias,
      title: a.title,
      body: null,
      url: a.url,
      item_codes: null,
      published_at: gdeltDateToIso(a.seendate),
    }
    if (classifyByRules(item)) rule++
    else if (shouldLlmClassify(item)) llm++
    else noise++
    if (samples.length < 3) samples.push(a.title)
  }
  stats.push({
    canonical: row.portfolio_company_canonical,
    alias: row.alias,
    source: row.source,
    hits: articles.length,
    rule_matches: rule,
    llm_candidates: llm,
    noise,
    samples,
  })
  done++
  if (done % 25 === 0) {
    const rate = done / ((Date.now() - t0) / 1000)
    console.error(`  ${done}/${aliases.length} (${rate.toFixed(1)}/s) — eta ${((aliases.length - done) / rate).toFixed(0)}s`)
  }
}

// ─── aggregate + report ───────────────────────────────────────────────────
const total_hits = stats.reduce((a, s) => a + s.hits, 0)
const total_rule = stats.reduce((a, s) => a + s.rule_matches, 0)
const total_llm = stats.reduce((a, s) => a + s.llm_candidates, 0)
const total_noise = stats.reduce((a, s) => a + s.noise, 0)
const empty = stats.filter((s) => s.hits === 0).length

console.log("\n══════════════════════════════════════════════════════════════")
console.log(`SUMMARY · ${aliases.length} aliases · GDELT timespan=${TIMESPAN}`)
console.log("══════════════════════════════════════════════════════════════")
console.log(`total articles returned:     ${total_hits}`)
console.log(`  matched by rule:           ${total_rule.toString().padStart(5)}  (${pct(total_rule, total_hits)})`)
console.log(`  candidates for LLM gate:   ${total_llm.toString().padStart(5)}  (${pct(total_llm, total_hits)})`)
console.log(`  noise (skipped):           ${total_noise.toString().padStart(5)}  (${pct(total_noise, total_hits)})`)
console.log(`aliases with zero hits:      ${empty} / ${aliases.length}  (${pct(empty, aliases.length)})`)

const llmCostUsd = total_llm * 0.00075
console.log(`\nestimated LLM cost if all candidates classified: $${llmCostUsd.toFixed(2)}`)
console.log(`  (Haiku 4.5 ≈ $0.00075/call; scales linearly with daily volume)`)

console.log("\n──────────────────────────────────────────────────────────────")
console.log("BY SOURCE")
console.log("──────────────────────────────────────────────────────────────")
const bySource = new Map<string, { aliases: number; hits: number; rule: number; noise: number }>()
for (const s of stats) {
  const cur = bySource.get(s.source) ?? { aliases: 0, hits: 0, rule: 0, noise: 0 }
  cur.aliases++; cur.hits += s.hits; cur.rule += s.rule_matches; cur.noise += s.noise
  bySource.set(s.source, cur)
}
for (const [src, s] of bySource) {
  console.log(`${src.padEnd(20)} · ${s.aliases.toString().padStart(4)} aliases · ${s.hits.toString().padStart(5)} hits · rule-match ${pct(s.rule, s.hits)}`)
}

console.log("\n──────────────────────────────────────────────────────────────")
console.log("TOP 20 NOISIEST ALIASES (high hits, low rule match, high noise)")
console.log("──────────────────────────────────────────────────────────────")
const noisy = stats
  .filter((s) => s.hits >= 5)
  .sort((a, b) => b.noise - a.noise)
  .slice(0, 20)
for (const s of noisy) {
  console.log(`  ${s.hits.toString().padStart(3)} hits · ${s.noise} noise · rule=${s.rule_matches} · "${s.alias}" [${s.source}]`)
  console.log(`     ← ${s.canonical}`)
  for (const t of s.samples) console.log(`       · ${t.slice(0, 100)}`)
}

console.log("\n──────────────────────────────────────────────────────────────")
console.log("TOP 20 RULE-MATCHED ALIASES (real signal)")
console.log("──────────────────────────────────────────────────────────────")
const winners = stats
  .filter((s) => s.rule_matches > 0)
  .sort((a, b) => b.rule_matches - a.rule_matches)
  .slice(0, 20)
for (const s of winners) {
  console.log(`  ${s.rule_matches} rule · ${s.hits} hits · "${s.alias}" [${s.source}]`)
  for (const t of s.samples) console.log(`       · ${t.slice(0, 100)}`)
}

console.log("\n──────────────────────────────────────────────────────────────")
console.log("ZERO-HIT ALIASES (consider removing or refining)")
console.log("──────────────────────────────────────────────────────────────")
console.log(`${empty} total. First 20:`)
for (const s of stats.filter((s) => s.hits === 0).slice(0, 20)) {
  console.log(`  "${s.alias}"  ← ${s.canonical}  [${s.source}]`)
}

function pct(n: number, d: number): string {
  if (d === 0) return "  0%"
  return `${((n / d) * 100).toFixed(1)}%`.padStart(5)
}
