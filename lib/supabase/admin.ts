import "server-only"
import { createClient } from "@supabase/supabase-js"

/**
 * Admin Supabase client — uses the service role key and bypasses RLS.
 *
 * Use ONLY in server-side code (route handlers, server actions, cron jobs).
 * The `server-only` import above will cause a build error if this file is
 * ever imported into a client component.
 *
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the browser. Do not prefix it
 * with NEXT_PUBLIC_.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
