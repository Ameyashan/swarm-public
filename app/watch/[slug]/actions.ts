"use server"

import { createClient } from "@/lib/supabase/server"

export type EnrichmentQueueResult =
  | { ok: true; queuedAt: string }
  | { ok: false; error: string }

/**
 * Insert a `queued` row into `enrichment_queue` so the Python pipeline picks
 * up this borrower for fresh Perplexity-research enrichment.
 *
 * RLS on enrichment_queue allows anon insert when status='queued', so this
 * works without service-role credentials.
 */
export async function queueEnrichmentRefresh(
  borrowerCanonical: string,
): Promise<EnrichmentQueueResult> {
  if (!borrowerCanonical || borrowerCanonical.trim().length === 0) {
    return { ok: false, error: "Missing borrower" }
  }

  const supabase = createClient()
  const { data, error } = await supabase
    .from("enrichment_queue")
    .insert({
      borrower_canonical: borrowerCanonical,
      status: "queued",
    })
    .select("requested_at")
    .single()

  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true, queuedAt: data?.requested_at ?? new Date().toISOString() }
}
