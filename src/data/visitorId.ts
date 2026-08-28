import { nanoid } from 'nanoid'

// A stable per-browser identifier for the AI-generation rate limiter (see
// api/_lib/rateLimit.ts) — this app has no accounts, so there's no user id
// to key a per-visitor quota off of. Plain localStorage, not useStorage(),
// since nothing needs to react to this changing — it's read once per
// request and never updated after creation.
//
// Deliberately NOT a security boundary: incognito/private browsing gets a
// fresh id every time, trivially resetting the per-visitor counters. That's
// accepted — this id only backs the "fair share" layer (no single visitor
// exhausts the whole day's quota), not the cost ceiling itself, which is the
// global per-day counter and doesn't depend on visitor identity at all. See
// the rate-limit design conversation for the full reasoning.
const STORAGE_KEY = 'tripflow-visitor-id'

export function getVisitorId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing) return existing
    const id = nanoid()
    window.localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    // Storage disabled/unavailable (private mode with storage blocked,
    // browser settings) — the request just proceeds without session-level
    // rate limiting, same as any other missing-visitor-id case server-side.
    return undefined
  }
}
