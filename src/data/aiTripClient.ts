import type { CreateTripInput } from '../types'
import { resolveCitySegments, targetCountForWindow, windowForFlightDay, windowForTransitDay } from './generateTrip.ts'
import type { CitySegment, DayWindow, PlaceSuggestion } from './generateTrip'

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
//
// Multi-destination trips (see CreateTripInput.cities) are orchestrated as
// N independent single-city plans, one per resolveCitySegments() segment —
// each segment gets its OWN zone-planning call (buildZonePlanPrompt's "every
// day, all at once" theming only makes sense scoped to one city; a shared
// call across cities would hand a day in Brussels a zone hint themed for
// Amsterdam) and its own city-center geocode, run in parallel across
// segments the same way per-day requests already run in parallel within a
// segment. Every request still ultimately talks about exactly one city and
// exactly one day, same contract api/generate-trip-day.ts already enforces —
// multi-city didn't change what a single request means, only how many get
// issued and with which (destination, day-within-that-city) pair. A
// single-destination trip is the same one-segment case it always was
// (resolveCitySegments collapses to one segment spanning every day), so this
// file's behavior for it is unchanged.

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

// Caps how many /api/generate-trip-day requests are in flight at once (and,
// separately, how many /api/plan-trip-zones segment calls run in parallel —
// the two never overlap in time, so this one constant safely bounds both).
// Unbounded parallelism here would fan out one Claude + Google Places call
// per day simultaneously — for a 30-day trip that's a burst large enough to
// risk the Anthropic account's own rate limit (which applies account-wide,
// not per request), not just overload the browser's own connection pool.
// api/generate-trip-day.ts's own VERIFY_CONCURRENCY is sized against this
// same constant (see its comment) so the two stay coordinated.
const MAX_PARALLEL_REQUESTS = 4

type ZoneHint = { day: number; zone: string; focus: string; assignedPreferences: string[] }
type GeoPoint = { lat: number; lng: number }

// The subset of CreateTripInput a single segment's zone-planning/day-request
// bodies actually vary by — just the destination, since everything else
// (travelStyle, additionalNotes, dates) is trip-wide. Kept separate from
// CreateTripInput itself so a segment's own destination can't accidentally
// get read from the wrong field somewhere in this file.
type ZonePlanContext = {
  destination: string
  travelStyle?: string[]
  preferences?: string[]
  additionalNotes?: string
}

// One city segment's resolved generation context — its own zone hints (day
// numbers here are RELATIVE to the segment, 1..segment's own day count, same
// as what was sent to plan them) and city center, planned once up front and
// reused by every day-request for that segment (first pass AND backfill),
// same as the single-segment case already reused one shared planZones()
// result for its whole trip.
type SegmentPlan = {
  segment: CitySegment
  // segment.endDay - segment.startDay + 1, precomputed once here rather than
  // recomputed independently at each of this file's two call sites (they'd
  // drifted apart from CitySegment's own day-numbering convention
  // separately before; this is now the one place that arithmetic happens).
  segmentDays: number
  zones: ZoneHint[]
  cityCenter: GeoPoint | null
}

// Runs `fn` over `items` with at most `limit` in flight at once — the
// client-side twin of the same worker-pool helper in api/_lib/tripGen.ts
// (mapWithConcurrency). Not reused directly: api/ and src/ are independent
// deployable units (see e.g. the STYLE_FLAVOR / PLACE_CATEGORIES copies
// already split the same way), and the existing client-side queues in
// geocode.ts/routing.ts are strictly-serial rate limiters (concurrency 1),
// not the bounded-parallelism this needs.
//
// Contract: `fn` must never throw — if it can fail, it must catch its own
// error and resolve to a sentinel instead (every caller below already does
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

// Distributes the user's full preference list across a multi-city trip's
// segments, proportional to each segment's own day share, for zone-planning
// ONLY — buildZonePlanPrompt's "assign every preference to at least one day"
// instruction is sized against whatever totalDays it's given, so calling it
// once per segment with the FULL preference list would force a short
// segment (say, a 2-day city) to cram every preference the user picked (say,
// 6) into just its own couple of days. day-generation requests (requestDay)
// deliberately do NOT use this — they always get the full, untrimmed list,
// since a day's own "include at least one food place" instruction and
// context line should reflect the user's actual full selection regardless
// of which segment that day belongs to.
//
// Doesn't special-case the food preference (unlike buildZonePlanPrompt's own
// FOOD_PREFERENCE exclusion) — that instruction already filters it out of
// the distribution requirement server-side regardless of what's sent here,
// so there's nothing for this function to get wrong by not knowing about it.
// Single-segment trips return the input unchanged — no split to make.
export function preferencesForSegment(preferences: string[] | undefined, segment: CitySegment, segments: CitySegment[]): string[] | undefined {
  if (!preferences || preferences.length === 0 || segments.length <= 1) return preferences

  const totalDays = segments.at(-1)!.endDay
  // Largest-remainder apportionment (the same method used for allocating
  // legislative seats proportionally — Hamilton's method): each segment's
  // ideal share is preferences.length * (its own day count / totalDays);
  // every segment first gets floor(ideal), then whatever's left over is
  // handed out one at a time to whichever segments had the largest
  // fractional remainder, until every preference is assigned. An earlier
  // version of this function instead mapped each preference's array index
  // to an evenly-spread "day slot" and looked up which segment owned that
  // day — simpler, but coarse enough that a short segment could round down
  // to a full ZERO preferences even when there were technically enough to
  // go around (confirmed regression: 2 preferences across a 3-day+2-day
  // split gave the 2-day segment none at all, both landing on the 3-day
  // segment's days). Largest-remainder guarantees every segment gets at
  // least floor(ideal), which is >= 1 whenever preferences.length is at
  // least segments.length.
  const ideals = segments.map((candidate) => (preferences.length * (candidate.endDay - candidate.startDay + 1)) / totalDays)
  const counts = ideals.map((ideal) => Math.floor(ideal))
  let remaining = preferences.length - counts.reduce((sum, count) => sum + count, 0)
  const byRemainderDesc = ideals
    .map((ideal, index) => ({ index, remainder: ideal - Math.floor(ideal) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { index } of byRemainderDesc) {
    if (remaining <= 0) break
    counts[index] += 1
    remaining -= 1
  }

  const buckets: string[][] = []
  let cursor = 0
  for (const count of counts) {
    buckets.push(preferences.slice(cursor, cursor + count))
    cursor += count
  }

  // Matched by day range, not object reference (findIndex + ===) — segment
  // is guaranteed to be one of `segments`' own elements by every current
  // caller, but reference equality would silently return [] for a
  // structurally-identical-but-reconstructed segment object with no error,
  // a needless footgun for a check this cheap to make robust instead.
  const matchIndex = segments.findIndex((candidate) => candidate.startDay === segment.startDay && candidate.endDay === segment.endDay)
  return buckets[matchIndex] ?? []
}

// Stage 1 (per segment): plans ONE city's whole day-by-day theme/area
// outline, and resolves that city's center once so every later per-day
// request for it can reuse it instead of each geocoding it redundantly.
// Best-effort and never throws — a failure here just means that segment's
// day-requests proceed with no zone hints and no shared city center, same as
// before this endpoint existed (and same as any OTHER segment's independent
// success/failure — one city's zone-planning failing doesn't affect
// another's).
async function planZones(ctx: ZonePlanContext, totalDays: number): Promise<{ zones: ZoneHint[]; cityCenter: GeoPoint | null }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ZONE_HINT_TIMEOUT_MS)
  try {
    const response = await fetch('/api/plan-trip-zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: ctx.destination,
        travelStyle: ctx.travelStyle,
        preferences: ctx.preferences,
        additionalNotes: ctx.additionalNotes,
        totalDays,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`[aiTripClient] /api/plan-trip-zones (${ctx.destination}) returned ${response.status}, proceeding with no zone hints`)
      return { zones: [], cityCenter: null }
    }
    const data = (await response.json()) as { zones?: ZoneHint[]; cityCenter?: GeoPoint | null }
    return { zones: Array.isArray(data.zones) ? data.zones : [], cityCenter: data.cityCenter ?? null }
  } catch (error) {
    console.error(`[aiTripClient] /api/plan-trip-zones (${ctx.destination}) failed, proceeding with no zone hints`, error)
    return { zones: [], cityCenter: null }
  } finally {
    window.clearTimeout(timer)
  }
}

// One request for one day of one segment. Never throws — any failure
// (network error, timeout, non-2xx, malformed body) resolves to an empty
// array, same as that day simply not having any candidates yet; the caller
// treats a short/empty day uniformly whether it came from an outright
// request failure or a request that succeeded with fewer verified places.
// Non-2xx responses ARE logged (with status + day), though, so a systemic
// client/server contract bug is distinguishable in the console from
// ordinary per-day verification attrition instead of silently looking the
// same as a short day.
//
// `day`/`totalDays` sent to the server are RELATIVE to the segment (e.g.
// "day 2 of 2" for a 2-day city), not absolute trip day numbers — Claude
// uses them to gauge how deep into THIS city's visit it is (buildDayPrompt's
// "這是一趟共 X 天行程裡的第 Y 天" framing), which would be actively
// misleading if it were told "day 5 of 7" for what's actually day 2 of a
// fresh 2-day stop in a different city than where the trip started.
// `absoluteDay`/`totalTripDays` are used ONLY to decide whether this
// request is the one that gets arrivalTime/departureTime (those are real
// clock times tied to the whole trip's actual first/last day, not
// whichever city happens to be visited first/last) — every returned place
// gets re-tagged from the segment-relative day the server force-corrected
// it to (see api/generate-trip-day.ts) back to `absoluteDay` before
// resolving, so callers merging this into a trip-wide place list never see
// the relative numbering at all.
type RequestDayParams = {
  input: CreateTripInput
  segmentDestination: string
  absoluteDay: number
  totalTripDays: number
  relativeDay: number
  segmentDays: number
  dayWindow: DayWindow
  zones: ZoneHint[]
  cityCenter: GeoPoint | null
  existingAnchor?: GeoPoint | null
}

async function requestDay({
  input,
  segmentDestination,
  absoluteDay,
  totalTripDays,
  relativeDay,
  segmentDays,
  dayWindow,
  zones,
  cityCenter,
  existingAnchor = null,
}: RequestDayParams): Promise<PlaceSuggestion[]> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), DAY_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch('/api/generate-trip-day', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: segmentDestination,
        travelStyle: input.travelStyle,
        preferences: input.preferences,
        additionalNotes: input.additionalNotes,
        totalDays: segmentDays,
        day: relativeDay,
        targetPlaceCount: targetCountForWindow(dayWindow),
        windowStart: dayWindow.start,
        windowEnd: dayWindow.end,
        zones,
        cityCenter,
        existingAnchor,
        // Only relevant (and only sent) for the day the flight actually
        // affects — buildDayPrompt uses these to steer candidate choice
        // (e.g. not a sunrise-market pick when arrival is mid-afternoon),
        // on top of dayWindow already being narrowed for this day (see
        // windowForFlightDay/windowForTransitDay). Gated on the ABSOLUTE day
        // — a flight only ever lands/departs on the whole trip's real first/
        // last day, not a per-segment one.
        arrivalTime: absoluteDay === 1 ? input.arrivalTime : undefined,
        departureTime: absoluteDay === totalTripDays ? input.departureTime : undefined,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`[aiTripClient] /api/generate-trip-day (${segmentDestination}) day ${absoluteDay} returned ${response.status}`)
      return []
    }
    const data = (await response.json()) as { places?: unknown }
    if (!Array.isArray(data.places)) return []
    // Server force-corrected every place's `day` to `relativeDay` (whatever
    // was sent above) — overwritten here to the absolute trip day, the only
    // numbering the rest of this file (and generateTrip.ts's own grouping)
    // understands.
    return (data.places as PlaceSuggestion[]).map((place) => ({ ...place, day: absoluteDay }))
  } catch (error) {
    console.error(`[aiTripClient] /api/generate-trip-day (${segmentDestination}) day ${absoluteDay} failed`, error)
    return []
  } finally {
    window.clearTimeout(timer)
  }
}

// Which segment an absolute day number belongs to — same "day falls in this
// segment's inclusive range" lookup generateTrip.ts's own cityIdForDay uses
// (both ultimately trust resolveCitySegments' own defensive last-segment
// extension, so this never fails to find one in practice).
function planForDay(plans: SegmentPlan[], absoluteDay: number): SegmentPlan {
  return plans.find((plan) => absoluteDay >= plan.segment.startDay && absoluteDay <= plan.segment.endDay) ?? plans[plans.length - 1]!
}

// windowForDay resolves each day's own active-hours window rather than one
// flat window for the whole batch — day 1 / the trip's last day can be
// narrowed by a known flight, and a multi-city trip's segment-transition
// days by inter-city travel time (see windowForFlightDay/windowForTransitDay
// in generateTrip.ts). A day whose window is too short to fit even one place
// (targetCountForWindow's own "too short" floor — not just a fully
// zero-length window) is skipped entirely rather than sent as a request the
// server would reject (generate-trip-day.ts requires targetPlaceCount >= 1).
// Uses targetCountForWindow itself (not a separate start!==end check) so
// this and daysNeedingBackfill's skip condition can never disagree.
async function fetchDays(
  input: CreateTripInput,
  plans: SegmentPlan[],
  absoluteDays: number[],
  totalTripDays: number,
  windowForDay: (day: number) => DayWindow,
  anchorForDay?: (day: number) => GeoPoint | null,
): Promise<PlaceSuggestion[]> {
  const requestableDays = absoluteDays.filter((day) => targetCountForWindow(windowForDay(day)) > 0)
  const results = await mapWithConcurrency(requestableDays, MAX_PARALLEL_REQUESTS, (absoluteDay) => {
    const plan = planForDay(plans, absoluteDay)
    return requestDay({
      input,
      segmentDestination: plan.segment.destination,
      absoluteDay,
      totalTripDays,
      relativeDay: absoluteDay - plan.segment.startDay + 1,
      segmentDays: plan.segmentDays,
      dayWindow: windowForDay(absoluteDay),
      zones: plan.zones,
      cityCenter: plan.cityCenter,
      existingAnchor: anchorForDay?.(absoluteDay) ?? null,
    })
  })
  return results.flat()
}

// Same placeId rule api/generate-trip.ts used to apply in one shared
// in-memory Set (see this file's top comment) — first occurrence wins.
// `days` (and therefore the flattened results) are fetched in day order, so
// "first occurrence" is the same as "earlier day wins" today. Places with
// no placeId (the no-Google-key fallback path) can't be compared this way
// and are kept as-is.
//
// A multi-city trip visiting the same real-world place from two different
// segments (rare, but e.g. a landmark visible/listed from both a lakeside
// city and its neighbor) still dedups correctly here — placeId identifies
// the real-world location regardless of which segment's request found it.
// A trip revisiting the same CITY twice (Tokyo → Kyoto → Tokyo) is a
// different, unresolved problem: each Tokyo segment plans its zones
// independently with no awareness of the other, so they can converge on
// near-identical picks that this dedup then has to arbitrate between,
// silently starving whichever segment's requests happened to lose the race
// — tracked as a follow-up, not solved by this function.
export function dedupeByPlaceId(places: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>()
  return places.filter((place) => {
    if (!place.placeId) return true
    if (seen.has(place.placeId)) return false
    seen.add(place.placeId)
    return true
  })
}

// A day can end up short of its own target for reasons that only exist once
// generation is split across independent requests — most notably losing a
// candidate to the cross-day dedup above — on top of the usual verification
// attrition. Returns every day under its target, not just empty ones. A day
// whose window is zero-length (see windowForDay) is never "short" — it
// wasn't requested at all.
export function daysNeedingBackfill(places: PlaceSuggestion[], totalDays: number, windowForDay: (day: number) => DayWindow): number[] {
  const countByDay = new Map<number, number>()
  for (const place of places) {
    if (typeof place.day !== 'number') continue
    countByDay.set(place.day, (countByDay.get(place.day) ?? 0) + 1)
  }
  const short: number[] = []
  for (let day = 1; day <= totalDays; day++) {
    const target = targetCountForWindow(windowForDay(day))
    if (target > 0 && (countByDay.get(day) ?? 0) < target) short.push(day)
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
export function findExistingAnchor(places: PlaceSuggestion[], day: number): GeoPoint | null {
  const place = places.find((p) => p.day === day && typeof p.lat === 'number' && typeof p.lng === 'number')
  return place ? { lat: place.lat!, lng: place.lng! } : null
}

// Talks to /api/plan-trip-zones + /api/generate-trip-day (Vercel serverless
// functions calling Claude Sonnet + Google Places) — once per segment for
// zone-planning, then once per (segment, day) for candidate generation. See
// this file's top comment for how a multi-city trip fans out into
// independent per-segment plans. Returns undefined — never throws — only
// when the result is genuinely empty after both the initial pass and the one
// backfill round below. trips.ts's createTrip() treats undefined as a hard
// failure and shows a retry prompt instead of falling back to local template
// data, so this function must not report success on a fully empty result.
export async function fetchAiPlaces(
  input: CreateTripInput,
  days: number,
  baseWindow: DayWindow,
): Promise<PlaceSuggestion[] | undefined> {
  const segments = resolveCitySegments(input, days)

  // Every segment's zone-planning + city-center resolution runs in
  // parallel — independent cities have nothing to wait on each other for.
  // A single-destination trip is the one-segment case (see this file's top
  // comment): this reduces to exactly one planZones() call, same as before
  // per-city planning existed.
  const plans: SegmentPlan[] = await mapWithConcurrency(segments, MAX_PARALLEL_REQUESTS, async (segment) => {
    const segmentDays = segment.endDay - segment.startDay + 1
    const { zones, cityCenter } = await planZones(
      {
        destination: segment.destination,
        travelStyle: input.travelStyle,
        preferences: preferencesForSegment(input.preferences, segment, segments),
        additionalNotes: input.additionalNotes,
      },
      segmentDays,
    )
    return { segment, segmentDays, zones, cityCenter }
  })

  // Day 1 / the last day get a narrower window when a known flight
  // arrival/departure shortens their usable hours, and a segment-transition
  // day gets narrowed for inter-city travel time (see windowForFlightDay/
  // windowForTransitDay — mutually exclusive by construction, see the
  // latter's own comment). Resolved once and reused by both the first pass
  // and the backfill round below so they stay consistent with each other
  // and with generateTrip.ts's own per-day duration-budget walk (which
  // composes the exact same two functions the same way).
  const windowForDay = (day: number) => windowForTransitDay(windowForFlightDay(baseWindow, day, days, input), day, segments)

  const dayNumbers = Array.from({ length: Math.ceil(days / DAYS_PER_REQUEST) }, (_, i) => i + 1)
  const firstPass = await fetchDays(input, plans, dayNumbers, days, windowForDay)
  let merged = dedupeByPlaceId(firstPass)

  // One bounded backfill round for whatever's still short — a fresh,
  // independent request per day with its own full timeout budget, not a
  // retry racing against however much time the first pass already used.
  // Each backfill request carries the day's existing anchor (if any) so it
  // stays geographically consistent with what the first pass already
  // accepted, rather than independently anchoring on its own first hit.
  // Doesn't loop: a day still short after this stays short, same as the old
  // single-request design's "a short day is legitimate" philosophy for
  // ordinary verification attrition. Reuses each day's segment's already-
  // planned zones/cityCenter (via `plans`) rather than re-planning.
  const shortDays = daysNeedingBackfill(merged, days, windowForDay)
  if (shortDays.length > 0) {
    const backfillPlaces = await fetchDays(input, plans, shortDays, days, windowForDay, (day) => findExistingAnchor(merged, day))
    merged = dedupeByPlaceId([...merged, ...backfillPlaces])
  }

  // A whole segment (city) with zero places despite having at least one day
  // actually worth requesting means AI generation systematically failed for
  // that specific destination — not just ordinary per-day verification
  // attrition, which the "a short day is legitimate" philosophy above
  // already tolerates for individual days within an otherwise-working
  // segment. Without this, a trip where one city's zone-planning and every
  // one of its day-requests all failed (while other cities succeeded) would
  // still report success — merged.length > 0 from the OTHER segments alone
  // — silently shipping a trip with an entire city's worth of days blank
  // instead of surfacing the retry prompt createTrip() shows on failure. A
  // segment whose every day legitimately has a zero-length window (fully
  // consumed by a flight/transit narrowing, e.g. a 1-day stopover with no
  // usable hours) is NOT a failure — there was nothing to request in the
  // first place. For a single-segment (single-destination) trip this can
  // only ever agree with the plain merged.length check below, since one
  // segment spanning every day means "this segment has no places" and "the
  // whole trip has no places" are the same statement.
  const failedSegment = plans.some((plan) => {
    const segmentDayNumbers = Array.from({ length: plan.segment.endDay - plan.segment.startDay + 1 }, (_, i) => plan.segment.startDay + i)
    const hasRequestableDay = segmentDayNumbers.some((day) => targetCountForWindow(windowForDay(day)) > 0)
    if (!hasRequestableDay) return false
    return !merged.some((place) => typeof place.day === 'number' && place.day >= plan.segment.startDay && place.day <= plan.segment.endDay)
  })

  return merged.length > 0 && !failedSegment ? merged : undefined
}
