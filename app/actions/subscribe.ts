"use server"

import { createClient } from "@/lib/supabase/server"

export type SubscribeResult = {
  ok: boolean
  message: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function subscribeAction(
  _prev: SubscribeResult | null,
  formData: FormData,
): Promise<SubscribeResult> {
  const rawEmail = (formData.get("email") || "").toString().trim().toLowerCase()
  const source = (formData.get("source") || "homepage").toString().slice(0, 64)

  if (!rawEmail) {
    return { ok: false, message: "Please enter an email." }
  }
  if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 254) {
    return { ok: false, message: "That doesn't look like a valid email." }
  }

  try {
    const supabase = createClient()
    const { error } = await supabase
      .from("subscribers")
      .insert({ email: rawEmail, source })

    if (error) {
      // Unique violation on lower(email) → already subscribed
      if (error.code === "23505") {
        return { ok: true, message: "You're already on the list. Thanks." }
      }
      console.error("subscribe insert error", error)
      return {
        ok: false,
        message: "Something went wrong. Please try again.",
      }
    }
    return {
      ok: true,
      message: "You're on the list. Weekly digests start soon.",
    }
  } catch (e) {
    console.error("subscribe action exception", e)
    return { ok: false, message: "Unexpected error. Please try again." }
  }
}
