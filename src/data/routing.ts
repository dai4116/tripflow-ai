import type { TravelMode } from '../types'

export type GeoPoint = { lat: number; lng: number }
export type TravelEstimate = { durationMin: number; distanceKm: number }

// Shared by TravelTimeRow.vue (the inline board display) and
// TravelTimeModal.vue (the picker's own manual-entry button) so the two
// always read the same way — "80" minutes is "1 小時 20分" in both places,
// not raw minutes in one and hours+minutes in the other.
export function formatTravelDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} 分`
  if (minutes === 0) return `${hours} 小時`
  return `${hours} 小時 ${minutes}分`
}

// Talks to /api/route (a Vercel serverless function proxying
// OpenRouteService) — mirrors aiTripClient.ts's fetchAiPlaces: the API key
// lives server-side only, and this never throws, just resolves null on any
// failure (no route in local `vite dev`, missing key, timeout, no path
// found between the two points, etc). Callers treat "no estimate yet" as a
// normal state, not an error.
// Slightly longer than the server's own upstream call is expected to take,
// and shorter than the serverless function's 30s maxDuration — so on a slow
// route lookup the client is the one that decides to give up, with the
// server never self-killing first.
const REQUEST_TIMEOUT_MS = 15000

// Serialized rather than fired in parallel — this app has no server-side
// rate limiting of its own, so bursts from one browser session are the only
// thing standing between it and OpenRouteService's daily quota.
const MIN_INTERVAL_MS = 300

// Keyed on the in-flight/settled Promise itself, not just the resolved
// value — two callers asking for the same pair before either resolves (e.g.
// the store's background auto-fill and the modal's own loadEstimate) share
// one network request instead of each firing their own against ORS's daily
// quota. Entries for permanent negatives (404) stay; transient ones remove
// themselves on settle (see fetchTravelTime) so a later call retries.
const cache = new Map<string, Promise<TravelEstimate | null>>()
let queue: Promise<unknown> = Promise.resolve()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.then(
    () => delay(MIN_INTERVAL_MS),
    () => delay(MIN_INTERVAL_MS),
  )
  return run
}

export function fetchTravelTime(
  mode: Exclude<TravelMode, 'manual'>,
  from: GeoPoint,
  to: GeoPoint,
): Promise<TravelEstimate | null> {
  const key = `${mode}:${from.lat},${from.lng}:${to.lat},${to.lng}`
  const cached = cache.get(key)
  if (cached) return cached

  // Set synchronously, before the request even starts — a concurrent caller
  // arriving while this is in flight sees this same Promise in the map and
  // awaits its result instead of starting a second request.
  const promise = enqueue(async () => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, from, to }),
        signal: controller.signal,
      })

      // 404 = genuine "no route between these points" — a permanent negative
      // worth caching so we don't re-ask on every reorder. Any other non-ok
      // status (429 rate-limit, 502 transient upstream error, etc.) must NOT
      // stay cached: leaving it would poison this coordinate pair for the
      // whole session even though an immediate retry could succeed.
      if (response.status === 404) return null
      if (!response.ok) {
        cache.delete(key)
        return null
      }

      const data = (await response.json()) as Partial<TravelEstimate>
      if (typeof data.durationMin !== 'number' || typeof data.distanceKm !== 'number') {
        cache.delete(key)
        return null
      }

      return { durationMin: data.durationMin, distanceKm: data.distanceKm }
    } catch {
      // Abort (timeout), network blip, or malformed-JSON parse — all
      // transient, so uncache it to leave the door open for a later retry.
      cache.delete(key)
      return null
    } finally {
      window.clearTimeout(timer)
    }
  })

  cache.set(key, promise)
  return promise
}
