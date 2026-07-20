import type { CreateTripInput } from '../types'
import type { PlaceSuggestion } from './generateTrip'

// Generous on purpose — a cold Vercel function start + first-use structured
// output schema compilation + Sonnet's own generation time can combine to
// well over 10s on an infrequently-hit serverless function, and the
// realistic response size grew with pace-based place counts (up to 150
// places for a packed 30-day trip). Matches api/generate-trip.ts's
// maxDuration so the client doesn't give up before the server would.
const REQUEST_TIMEOUT_MS = 60000

// Talks to /api/generate-trip (a Vercel serverless function calling Claude
// Sonnet). Returns undefined — never throws — on any failure: no route in
// local `vite dev` (no server there), missing ANTHROPIC_API_KEY, timeout, a
// malformed response, or a short one (see the exact-count check below).
// trips.ts's createTrip() treats undefined as a hard failure and shows a
// retry prompt instead of falling back to local template data — so this
// function must not report success on anything less than a complete result.
export async function fetchAiPlaces(
  input: CreateTripInput,
  placeCount: number,
  days: number,
  placesPerDay: number,
): Promise<PlaceSuggestion[] | undefined> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch('/api/generate-trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: input.destination,
        travelStyle: input.travelStyle,
        preferences: input.preferences,
        avoidPlaces: input.avoidPlaces,
        placeCount,
        days,
        // Sent explicitly (not just placeCount/days) so the server doesn't
        // have to re-derive it via Math.round(placeCount/days) — this is
        // the exact value trips.ts already computed and used to build
        // placeCount, so sending it removes a second, independent
        // computation of the same number from the request path entirely.
        placesPerDay,
      }),
      signal: controller.signal,
    })
    if (!response.ok) return undefined

    const data = (await response.json()) as { places?: unknown }
    // Anything other than exactly placeCount is treated as a failure, not
    // just an empty array — generateTrip.ts slices this array into fixed-size
    // day chunks by position, so a short response wouldn't just mean "fewer
    // places," it would silently misalign every day after the shortfall and
    // backfill the rest from local CATEGORY_TEMPLATES, which is exactly the
    // silent-degrade behavior createTrip()'s hard-fail check exists to catch.
    if (!Array.isArray(data.places) || data.places.length !== placeCount) return undefined

    return data.places as PlaceSuggestion[]
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}
