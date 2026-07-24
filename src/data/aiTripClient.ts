import type { CreateTripInput } from '../types'
import type { PlaceSuggestion } from './generateTrip'

// Orchestrates trip generation as many small, parallel per-day requests
// instead of one request for the whole trip. The old design (a single call
// to /api/generate-trip that looped through every day server-side) had two
// coupled problems that got worse as trip length grew: total time scaled
// with day count, risking Vercel's 60s function limit on long trips; and
// packing multiple days into one Claude call left no way to detect the AI
// mistagging a candidate's day within that batch (confirmed live: a 7-day
// trip's day 2 came back completely empty while its batch-mate day 1 was
// full). Splitting into one request per day removes both: each request's
// cost is constant regardless of trip length, and a single-day request
// always gets the guaranteed-correct day tagging api/generate-trip-day.ts
// applies when it knows a whole request belongs to just one day.
//
// The trade-off this moves onto the client: cross-day duplicate places.
// api/generate-trip.ts used to dedup by Google placeId across every day in
// one shared in-memory Set, because all of a trip's candidates existed in
// the same function invocation. Independent parallel requests are separate
// invocations with no shared memory, so that dedup has to happen here,
// after all requests return (see dedupeByPlaceId below) — same placeId
// rule, just relocated.

// 5000ms margin over api/plan-trip-zones.ts's own maxDuration (20s) — the
// day-request pair below reserves the same kind of buffer for the same
// reason (network/serialization/cold-start latency on top of the server's
// own budget). Without it, a zone-planning call that legitimately finishes
// close to the server's own deadline gets aborted client-side right as it
// would have succeeded, needlessly discarding the zone hints and shared
// city-center geocode more often than necessary.
const ZONE_HINT_TIMEOUT_MS = 25000
const DAY_REQUEST_TIMEOUT_MS = 35000

// One day per request — this is what guarantees every request hits the
// safe, forced day-tagging path server-side (see api/generate-trip-day.ts).
// Kept as a named constant in case that trade-off (more, smaller requests
// vs. fewer, larger ones) ever needs retuning.
const DAYS_PER_REQUEST = 1

// Caps how many /api/generate-trip-day requests are in flight at once.
// Unbounded parallelism here would fan out one Claude + Google Places call
// per day simultaneously — for a 30-day trip that's a burst large enough to
// risk the Anthropic account's own rate limit (which applies account-wide,
// not per request), not just overload the browser's own connection pool.
// api/generate-trip-day.ts's own VERIFY_CONCURRENCY is sized against this
// same constant (see its comment) so the two stay coordinated.
const MAX_PARALLEL_REQUESTS = 4

type ZoneHint = { day: number; zone: string; focus: string }
type GeoPoint = { lat: number; lng: number }

// Runs `fn` over `items` with at most `limit` in flight at once — the
// client-side twin of the same worker-pool helper in api/_lib/tripGen.ts
// (mapWithConcurrency). Not reused directly: api/ and src/ are independent
// deployable units (see e.g. the STYLE_FLAVOR / PLACE_CATEGORIES copies
// already split the same way), and the existing client-side queues in
// geocode.ts/routing.ts are strictly-serial rate limiters (concurrency 1),
// not the bounded-parallelism this needs.
//
// Contract: `fn` must never throw — if it can fail, it must catch its own
// error and resolve to a sentinel instead (both callers below already do
// this). A thrown error still aborts the whole batch via Promise.all,
// discarding every other in-flight result; this logs the culprit first so
// it's diagnosable, but does not change that outcome.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    for (;;) {
      const i = nextIndex++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i]!)
      } catch (error) {
        console.error('[aiTripClient] mapWithConcurrency: fn threw — this violates its no-throw contract and aborts the whole batch', error)
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

// Stage 1: one call that plans the whole trip's day-by-day theme/area
// outline, and resolves the destination's city center once so every later
// per-day request can reuse it instead of each geocoding it redundantly.
// Best-effort and never throws — a failure here just means later requests
// proceed with no zone hints and no shared city center, same as before this
// endpoint existed.
async function planZones(input: CreateTripInput, totalDays: number): Promise<{ zones: ZoneHint[]; cityCenter: GeoPoint | null }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ZONE_HINT_TIMEOUT_MS)
  try {
    const response = await fetch('/api/plan-trip-zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: input.destination,
        travelStyle: input.travelStyle,
        preferences: input.preferences,
        additionalNotes: input.additionalNotes,
        totalDays,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`[aiTripClient] /api/plan-trip-zones returned ${response.status}, proceeding with no zone hints`)
      return { zones: [], cityCenter: null }
    }
    const data = (await response.json()) as { zones?: ZoneHint[]; cityCenter?: GeoPoint | null }
    return { zones: Array.isArray(data.zones) ? data.zones : [], cityCenter: data.cityCenter ?? null }
  } catch (error) {
    console.error('[aiTripClient] /api/plan-trip-zones failed, proceeding with no zone hints', error)
    return { zones: [], cityCenter: null }
  } finally {
    window.clearTimeout(timer)
  }
}

// One request for one day. Never throws — any failure (network error,
// timeout, non-2xx, malformed body) resolves to an empty array, same as
// that day simply not having any candidates yet; the caller treats a
// short/empty day uniformly whether it came from an outright request
// failure or a request that succeeded with fewer verified places. Non-2xx
// responses ARE logged (with status + day), though, so a systemic
// client/server contract bug is distinguishable in the console from
// ordinary per-day verification attrition instead of silently looking the
// same as a short day.
async function requestDay(
  input: CreateTripInput,
  day: number,
  totalDays: number,
  placesPerDay: number,
  zones: ZoneHint[],
  cityCenter: GeoPoint | null,
  existingAnchor: GeoPoint | null = null,
): Promise<PlaceSuggestion[]> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), DAY_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch('/api/generate-trip-day', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: input.destination,
        travelStyle: input.travelStyle,
        preferences: input.preferences,
        additionalNotes: input.additionalNotes,
        totalDays,
        day,
        placesPerDay,
        zones,
        cityCenter,
        existingAnchor,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`[aiTripClient] /api/generate-trip-day day ${day} returned ${response.status}`)
      return []
    }
    const data = (await response.json()) as { places?: unknown }
    return Array.isArray(data.places) ? (data.places as PlaceSuggestion[]) : []
  } catch (error) {
    console.error(`[aiTripClient] /api/generate-trip-day day ${day} failed`, error)
    return []
  } finally {
    window.clearTimeout(timer)
  }
}

async function fetchDays(
  input: CreateTripInput,
  days: number[],
  totalDays: number,
  placesPerDay: number,
  zones: ZoneHint[],
  cityCenter: GeoPoint | null,
  anchorForDay?: (day: number) => GeoPoint | null,
): Promise<PlaceSuggestion[]> {
  const results = await mapWithConcurrency(days, MAX_PARALLEL_REQUESTS, (day) =>
    requestDay(input, day, totalDays, placesPerDay, zones, cityCenter, anchorForDay?.(day) ?? null),
  )
  return results.flat()
}

// Same placeId rule api/generate-trip.ts used to apply in one shared
// in-memory Set (see this file's top comment) — first occurrence wins.
// `days` (and therefore the flattened results) are fetched in day order, so
// "first occurrence" is the same as "earlier day wins" today. Places with
// no placeId (the no-Google-key fallback path) can't be compared this way
// and are kept as-is.
function dedupeByPlaceId(places: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>()
  return places.filter((place) => {
    if (!place.placeId) return true
    if (seen.has(place.placeId)) return false
    seen.add(place.placeId)
    return true
  })
}

// A day can end up short of placesPerDay for reasons that only exist once
// generation is split across independent requests — most notably losing a
// candidate to the cross-day dedup above — on top of the usual verification
// attrition. Returns every day under its target, not just empty ones.
function daysNeedingBackfill(places: PlaceSuggestion[], totalDays: number, placesPerDay: number): number[] {
  const countByDay = new Map<number, number>()
  for (const place of places) {
    if (typeof place.day !== 'number') continue
    countByDay.set(place.day, (countByDay.get(place.day) ?? 0) + 1)
  }
  const short: number[] = []
  for (let day = 1; day <= totalDays; day++) {
    if ((countByDay.get(day) ?? 0) < placesPerDay) short.push(day)
  }
  return short
}

// The coordinates of the first already-accepted place for `day` in
// `places`, if any — sent along with a backfill request so
// api/generate-trip-day.ts can anchor its new candidates against what this
// day already has, instead of independently anchoring on whatever it finds
// first. Without this, a backfill request has no way to know where a day's
// existing places are, and a day that only needed ONE more place could end
// up with that place anywhere in the city.
function findExistingAnchor(places: PlaceSuggestion[], day: number): GeoPoint | null {
  const place = places.find((p) => p.day === day && typeof p.lat === 'number' && typeof p.lng === 'number')
  return place ? { lat: place.lat!, lng: place.lng! } : null
}

// Talks to /api/plan-trip-zones + /api/generate-trip-day (Vercel serverless
// functions calling Claude Sonnet + Google Places). Returns undefined —
// never throws — only when the result is genuinely empty after both the
// initial pass and the one backfill round below. trips.ts's createTrip()
// treats undefined as a hard failure and shows a retry prompt instead of
// falling back to local template data, so this function must not report
// success on a fully empty result.
export async function fetchAiPlaces(
  input: CreateTripInput,
  days: number,
  placesPerDay: number,
): Promise<PlaceSuggestion[] | undefined> {
  const { zones, cityCenter } = await planZones(input, days)

  const dayNumbers = Array.from({ length: Math.ceil(days / DAYS_PER_REQUEST) }, (_, i) => i + 1)
  const firstPass = await fetchDays(input, dayNumbers, days, placesPerDay, zones, cityCenter)
  let merged = dedupeByPlaceId(firstPass)

  // One bounded backfill round for whatever's still short — a fresh,
  // independent request per day with its own full timeout budget, not a
  // retry racing against however much time the first pass already used.
  // Each backfill request carries the day's existing anchor (if any) so it
  // stays geographically consistent with what the first pass already
  // accepted, rather than independently anchoring on its own first hit.
  // Doesn't loop: a day still short after this stays short, same as the old
  // single-request design's "a short day is legitimate" philosophy for
  // ordinary verification attrition.
  const shortDays = daysNeedingBackfill(merged, days, placesPerDay)
  if (shortDays.length > 0) {
    const backfillPlaces = await fetchDays(input, shortDays, days, placesPerDay, zones, cityCenter, (day) =>
      findExistingAnchor(merged, day),
    )
    merged = dedupeByPlaceId([...merged, ...backfillPlaces])
  }

  return merged.length > 0 ? merged : undefined
}
