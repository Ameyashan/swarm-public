"use client"

import { useFormState, useFormStatus } from "react-dom"
import { subscribeAction, type SubscribeResult } from "@/app/actions/subscribe"
import { Button } from "@/components/ui/button"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="shrink-0">
      {pending ? "Subscribing…" : "Subscribe"}
    </Button>
  )
}

export function SubscribeForm({ source = "homepage" }: { source?: string }) {
  const [state, action] = useFormState<SubscribeResult | null, FormData>(
    subscribeAction,
    null,
  )

  return (
    <div className="w-full max-w-md">
      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="source" value={source} />
        <input
          type="email"
          name="email"
          required
          placeholder="you@firm.com"
          autoComplete="email"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <SubmitButton />
      </form>
      {state && (
        <p
          className={
            "mt-2 text-sm " +
            (state.ok ? "text-green-700" : "text-destructive")
          }
          role="status"
          aria-live="polite"
        >
          {state.message}
        </p>
      )}
    </div>
  )
}
