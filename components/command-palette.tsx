"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Command } from "cmdk"
import { encodeCanonicalSlug } from "@/lib/slug"
import type { SearchHit } from "@/app/api/search/route"

type QuickAction = {
  id: string
  label: string
  hint?: string
  href: string
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "alerts-severe",
    label: "View highest severity alerts",
    hint: "Mark Drift Down, sorted by severity",
    href: "/alerts?detector=mark_drift_down",
  },
  {
    id: "alerts-pik",
    label: "View recent PIK Creep hits",
    hint: "Detector: PIK Creep",
    href: "/alerts?detector=pik_creep",
  },
  {
    id: "drift",
    label: "Show drift screener",
    hint: "Sortable borrower deterioration table",
    href: "/drift",
  },
  {
    id: "heatmap",
    label: "Show heatmap",
    hint: "Funds × quarters severity matrix",
    href: "/heatmap",
  },
  {
    id: "alerts-all",
    label: "Show all alerts",
    href: "/alerts",
  },
  {
    id: "funds",
    label: "Show funds",
    href: "/funds",
  },
]

/**
 * Global Cmd-K palette mounted in the root layout. Listens for the hotkey
 * anywhere in the app and renders a centered modal with live search across
 * funds + borrowers + static commands.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [funds, setFunds] = useState<SearchHit[]>([])
  const [borrowers, setBorrowers] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Hotkey: Cmd+K / Ctrl+K toggles. Esc closes (cmdk handles Esc internally).
  // Also listen for clicks on any element marked data-cmdk-trigger so the
  // server-rendered NavBar button can open us without prop drilling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest("[data-cmdk-trigger]")) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("click", onClick)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("click", onClick)
    }
  }, [])

  // Reset query when closed
  useEffect(() => {
    if (!open) {
      setQuery("")
      setFunds([])
      setBorrowers([])
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()

    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setFunds([])
      setBorrowers([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: ctrl.signal },
        )
        if (!res.ok) {
          setFunds([])
          setBorrowers([])
          return
        }
        const data = (await res.json()) as {
          funds: SearchHit[]
          borrowers: SearchHit[]
        }
        setFunds(data.funds ?? [])
        setBorrowers(data.borrowers ?? [])
      } catch (err) {
        if ((err as any)?.name !== "AbortError") {
          setFunds([])
          setBorrowers([])
        }
      } finally {
        setLoading(false)
      }
    }, 180)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const filteredQuickActions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return QUICK_ACTIONS
    return QUICK_ACTIONS.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.hint?.toLowerCase().includes(q),
    )
  }, [query])

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  const showQuickActions = filteredQuickActions.length > 0
  const showFunds = funds.length > 0
  const showBorrowers = borrowers.length > 0
  const showEmpty =
    query.trim().length > 0 &&
    !loading &&
    !showFunds &&
    !showBorrowers &&
    !showQuickActions

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Global search"
      className="cmdk-dialog"
      shouldFilter={false}
    >
      <div className="cmdk-overlay" aria-hidden onClick={() => setOpen(false)} />
      <div className="cmdk-shell">
        <div className="cmdk-input-wrap">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-muted-foreground"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search funds, borrowers, or run a command…"
            className="cmdk-input"
            autoFocus
          />
          <kbd className="cmdk-kbd">esc</kbd>
        </div>

        <Command.List className="cmdk-list">
          {showEmpty && (
            <Command.Empty className="cmdk-empty">
              No results for &ldquo;{query}&rdquo;
            </Command.Empty>
          )}

          {showQuickActions && (
            <Command.Group heading="Quick Actions" className="cmdk-group">
              {filteredQuickActions.map((a) => (
                <Command.Item
                  key={a.id}
                  value={`action-${a.id}-${a.label}`}
                  onSelect={() => go(a.href)}
                  className="cmdk-item"
                >
                  <span className="cmdk-icon" aria-hidden>
                    ⚡
                  </span>
                  <div className="cmdk-item-text">
                    <div className="cmdk-item-label">{a.label}</div>
                    {a.hint && (
                      <div className="cmdk-item-sub">{a.hint}</div>
                    )}
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {showFunds && (
            <Command.Group heading="Funds" className="cmdk-group">
              {funds.map((f) => (
                <Command.Item
                  key={`fund-${f.id}`}
                  value={`fund-${f.id}-${f.label}`}
                  onSelect={() => go(`/funds/${f.id}`)}
                  className="cmdk-item"
                >
                  <span className="cmdk-icon font-mono text-blue-300" aria-hidden>
                    {f.label.slice(0, 4)}
                  </span>
                  <div className="cmdk-item-text">
                    <div className="cmdk-item-label font-mono">{f.label}</div>
                    {f.sublabel && (
                      <div className="cmdk-item-sub">{f.sublabel}</div>
                    )}
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {showBorrowers && (
            <Command.Group heading="Borrowers" className="cmdk-group">
              {borrowers.map((b) => (
                <Command.Item
                  key={`borrower-${b.id}`}
                  value={`borrower-${b.id}`}
                  onSelect={() =>
                    go(`/watch/${encodeCanonicalSlug(b.id)}`)
                  }
                  className="cmdk-item"
                >
                  <span className="cmdk-icon" aria-hidden>
                    ◆
                  </span>
                  <div className="cmdk-item-text">
                    <div className="cmdk-item-label">{b.label}</div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {loading && (
            <div className="cmdk-loading">Searching…</div>
          )}
        </Command.List>

        <div className="cmdk-footer">
          <span className="flex items-center gap-1">
            <kbd className="cmdk-kbd-sm">↵</kbd> select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="cmdk-kbd-sm">↑</kbd>
            <kbd className="cmdk-kbd-sm">↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <kbd className="cmdk-kbd-sm">⌘</kbd>
            <kbd className="cmdk-kbd-sm">K</kbd> toggle
          </span>
        </div>
      </div>
    </Command.Dialog>
  )
}
