import { NextResponse } from "next/server"
import { runComposerQuery } from "@/lib/patterns/queries"
import { validateParsedQuery } from "@/lib/patterns/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = validateParsedQuery(body?.filters ?? {})
  const result = await runComposerQuery(parsed.filters)
  return NextResponse.json(result)
}
