import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Manual mark-override workflow (Phase 3). No auth surface in v1 — the
// `approver` field arrives as a typed string, matching the rest of the app's
// posture. Consistent with /patterns saved_patterns insert: open insert,
// auditable via the created_at + approver text.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CreateBody = {
  fund_ticker?: string
  portfolio_company_canonical?: string
  override_date?: string
  original_mark?: number
  override_mark?: number
  reason?: string
  approver?: string
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(req: NextRequest) {
  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return badRequest("invalid JSON body")
  }
  const fund_ticker = body.fund_ticker?.trim()
  const borrower = body.portfolio_company_canonical?.trim()
  const override_date = body.override_date?.trim()
  const reason = body.reason?.trim()
  const approver = body.approver?.trim()
  const original_mark = Number(body.original_mark)
  const override_mark = Number(body.override_mark)

  if (!fund_ticker || !borrower || !override_date) {
    return badRequest("fund_ticker, portfolio_company_canonical, override_date required")
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(override_date)) {
    return badRequest("override_date must be YYYY-MM-DD")
  }
  if (!Number.isFinite(original_mark) || !Number.isFinite(override_mark)) {
    return badRequest("original_mark and override_mark must be numbers")
  }
  if (!reason || reason.length < 5) {
    return badRequest("reason required (min 5 chars)")
  }
  if (!approver || approver.length < 2) {
    return badRequest("approver required")
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("mark_overrides")
    .insert({
      fund_ticker,
      portfolio_company_canonical: borrower,
      override_date,
      original_mark,
      override_mark,
      reason,
      approver,
      status: "pending",
    })
    .select(
      "id, fund_ticker, portfolio_company_canonical, override_date, original_mark, override_mark, reason, approver, status, created_at",
    )
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ override: data }, { status: 201 })
}

type PatchBody = {
  id?: string
  status?: "approved" | "rejected"
  approver?: string
}

export async function PATCH(req: NextRequest) {
  let body: PatchBody
  try {
    body = await req.json()
  } catch {
    return badRequest("invalid JSON body")
  }
  const id = body.id?.trim()
  const status = body.status
  const approver = body.approver?.trim()
  if (!id) return badRequest("id required")
  if (status !== "approved" && status !== "rejected") {
    return badRequest("status must be 'approved' or 'rejected'")
  }
  if (!approver || approver.length < 2) {
    return badRequest("approver required")
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("mark_overrides")
    .update({ status, approver })
    .eq("id", id)
    .select(
      "id, fund_ticker, portfolio_company_canonical, override_date, original_mark, override_mark, reason, approver, status, created_at",
    )
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ override: data })
}
