import type { CreateTripInput } from '../types'
import { resolveCitySegments, sameCity, segmentForDay, targetCountForWindow, windowForFlightDay, windowForTransitDay } from './generateTrip.ts'
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
// one independent plan per REAL city — see sameCity/planCitySegments for
// how a trip that revisits the same city more than
// once (Tokyo → Kyoto → Tokyo) still gets exactly ONE zone-planning call
// for "Tokyo" covering its combined day count, not one call per visit, so
// Claude plans that city's whole day-by-day theme/area outline together
// the same way it already does for an ordinary single-visit multi-day
// city — no separate "don't repeat what the earlier visit already covered"
// instruction needed, because there's no earlier visit from Claude's own
// point of view: it's one coherent planning call either way. Different
// cities' plans run in parallel — independent cities have nothing to wait
// on each other for. Every per-day request still ultimately talks about
// exactly one city and exactly one day, same contract
// api/generate-trip-day.ts already enforces — multi-city didn't change what
// a single request means, only how many get issued and with which
// (destination, day-within-that-city) pair. A single-destination trip is
// the same one-segment, one-group case it always was (resolveCitySegments
// collapses to one segment spanning every day), so this file's behavior for
// it is unchanged.

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
// separately, how many /api/plan-trip-zones GROUP calls run in parallel —
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

// The subset of CreateTripInput a single group's zone-planning body actually
// varies by — just the destination, since everything else (travelStyle,
// additionalNotes, dates) is trip-wide. Kept separate from CreateTripInput
// itself so a group's own destination can't accidentally get read from the
// wrong field somewhere in this file.
type ZonePlanContext = {
  destination: string
  travelStyle?: string[]
  preferences?: string[]
  additionalNotes?: string
  // Group-relative day numbers (1-indexed against THIS group's own
  // groupTotalDays) that a flight actually narrows — set only for the group
  // that owns the trip's real first/last absolute day (see
  // planCitySegments' own comment for why that's always day 1 / this
  // group's own last day, never anything in between). Lets stage 1 pick a
  // lighter/more-flexible theme for that day up front, instead of leaving
  // it to generate-trip-day.ts's own flightConstraintLine to steer around a
  // theme that's already locked in.
  arrivalDay?: number
  arrivalTime?: string
  departureDay?: number
  departureTime?: string
}

// One segment's resolved generation context. `zones`/`cityCenter` are
// planned once per CITY GROUP (see planCitySegments), not per segment — a
// repeated city's every occurrence shares the exact same `zones` array
// (by reference) and `cityCenter`, just starting its own group-relative day
// numbering from a different groupStartDay. `groupDestination` is likewise
// shared: the group's first occurrence's own destination text, used for
// EVERY segment's day-requests (not `segment.destination`) — sameCity's
// text fallback can merge two occurrences whose free-typed destination text
// differs (same city, different wording/specificity, e.g. "東京，日本" vs a
// free-typed "東京"), and every request for a group must describe the same
// place the same way Claude was told about when planning its zones, or the
// zone hints handed to a later day-request describe a place under a
// different name than what that request's own prompt says. `segmentDays` is
// this segment's own absolute day count (used by fetchAiPlaces'
// failedSegment check, which cares about THIS segment's own requestable
// days, not its group's combined total).
type SegmentPlan = {
  segment: CitySegment
  groupDestination: string
  segmentDays: number
  // This segment's own start day within its city GROUP's cumulative day
  // count (1-indexed) — e.g. Tokyo visited 3 days then 2 days later in the
  // trip has groupStartDay 1 for the first segment and 4 for the second,
  // both against the SAME shared groupTotalDays=5 and the SAME shared 5-day
  // zones array. (There's no groupEndDay field — every read site derives the
  // end from groupStartDay + this segment's own day span instead, since
  // nothing needs the end in isolation.)
  groupStartDay: number
  groupTotalDays: number
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

// Total day count across a whole group of segments (a repeated city's every
// visit combined) — the one place this arithmetic happens, shared by
// preferencesForGroup and planCitySegments below rather than each doing its
// own reduce() over the same shape (a prior version of this file already
// hit this exact class of drift once for a single segment's own day count —
// see SegmentPlan.segmentDays' own history).
function groupDays(group: CitySegment[]): number {
  return group.reduce((sum, s) => sum + (s.endDay - s.startDay + 1), 0)
}

// Distributes the user's full preference list across a multi-city trip's
// CITY GROUPS (not raw segments — a repeated city's multiple visits share
// one allocation, sized by their COMBINED day count, since they now plan as
// one unified multi-day visit — see planCitySegments), proportional to each
// group's own day share, for zone-planning ONLY — buildZonePlanPrompt's
// "assign every preference to at least one day" instruction is sized
// against whatever totalDays it's given, so calling it once per group with
// the FULL preference list would force a short group (say, a 2-day city) to
// cram every preference the user picked (say, 6) into just its own couple
// of days. day-generation requests (requestDay) deliberately do NOT use
// this — they always get the full, untrimmed list, since a day's own
// "include at least one food place" instruction and context line should
// reflect the user's actual full selection regardless of which group that
// day belongs to.
//
// Doesn't special-case the food preference (unlike buildZonePlanPrompt's own
// FOOD_PREFERENCE exclusion) — that instruction already filters it out of
// the distribution requirement server-side regardless of what's sent here,
// so there's nothing for this function to get wrong by not knowing about it.
// A single-group trip returns the input unchanged — no split to make.
export function preferencesForGroup(preferences: string[] | undefined, group: CitySegment[], allGroups: CitySegment[][]): string[] | undefined {
  if (!preferences || preferences.length === 0 || allGroups.length <= 1) return preferences

  const totalDays = allGroups.reduce((sum, candidate) => sum + groupDays(candidate), 0)

  // Largest-remainder apportionment (Hamilton's method), with a minimum-1
  // guarantee layered on top. Applied directly (no guarantee), this method
  // does NOT actually ensure every group gets >= 1 just because
  // preferences.length >= allGroups.length, despite that being the whole
  // point of using it over a coarser "evenly-spread day slot" approach tried
  // earlier — confirmed regression: a 1-day group alongside a 99-day group,
  // with exactly 2 preferences for those 2 groups, floors the 1-day group's
  // ideal share to 0 and it still loses the single leftover seat to the
  // 99-day group's larger fractional remainder. So: whenever there ARE
  // enough preferences to go around (preferences.length >= allGroups.length),
  // every group is guaranteed exactly 1 up front, and only the LEFTOVER
  // (preferences.length - allGroups.length) is apportioned by the same
  // largest-remainder method on top of that floor — trading strict
  // proportionality for "every city's zone planning gets touched by at
  // least one preference," which is this function's actual purpose. Below
  // that threshold, some groups legitimately get zero: there simply aren't
  // enough preferences for every city to have its own.
  const guaranteedEach = preferences.length >= allGroups.length ? 1 : 0
  const toApportion = preferences.length - guaranteedEach * allGroups.length

  const ideals = allGroups.map((candidate) => (toApportion * groupDays(candidate)) / totalDays)
  const counts = ideals.map((ideal) => guaranteedEach + Math.floor(ideal))
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

  // Matched by the group's own real-world city, not object reference —
  // `group` is guaranteed to be one of `allGroups`' own elements by the one
  // current caller (planCitySegments), but reference equality would
  // silently return [] for a structurally-identical-but-reconstructed group
  // with no error, a needless footgun for a check this cheap to make
  // robust instead.
  const matchIndex = allGroups.findIndex((candidate) => sameCity(candidate[0]!, group[0]!))
  return buckets[matchIndex] ?? []
}

// Stage 1 (per CITY GROUP): plans one city's whole day-by-day theme/area
// outline — covering every day that city gets across the WHOLE trip, even
// if a revisit means those days aren't contiguous on the calendar — and
// resolves that city's center once so every later per-day request for it
// can reuse it instead of each geocoding it redundantly. Best-effort and
// never throws — a failure here just means that group's day-requests
// proceed with no zone hints and no shared city center, same as before this
// endpoint existed (and same as any OTHER group's independent
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
        arrivalDay: ctx.arrivalDay,
        arrivalTime: ctx.arrivalTime,
        departureDay: ctx.departureDay,
        departureTime: ctx.departureTime,
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

// Groups segments by real-world city (see sameCity), then plans
// each group's zones + city center with exactly ONE /api/plan-trip-zones
// call covering that city's COMBINED day count across every visit — a trip
// revisiting Tokyo (3 days, then 2 more later) sends totalDays=5 for
// "Tokyo", not two separate 3-day and 2-day calls. This is what lets
// buildZonePlanPrompt's existing "plan all N days together, keep every
// day's theme different" instruction (already proven for an ordinary
// single-visit multi-day city) cover a revisited city too, with no separate
// "don't repeat what an earlier call already picked" mechanism needed —
// there IS no earlier call from Claude's point of view, just one coherent
// city-wide plan. Groups for DIFFERENT cities still plan in parallel with
// each other (bounded by MAX_PARALLEL_REQUESTS); a single-destination trip
// is the one-segment, one-group case, reducing to exactly one planZones()
// call, byte-for-byte the same request as before per-city planning existed.
async function planCitySegments(input: CreateTripInput, segments: CitySegment[], totalTripDays: number): Promise<SegmentPlan[]> {
  // sameCity is an OR-match (placeId when both sides have one, else text),
  // not a value that can serve as a Map key — an array scan is the plain
  // way to group by it. Segment counts are small (at most MAX_CITIES from
  // CreateTripPage, currently 8), so the O(n^2) scan here is negligible.
  const groups: CitySegment[][] = []
  for (const segment of segments) {
    const existingGroup = groups.find((group) => sameCity(group[0]!, segment))
    if (existingGroup) existingGroup.push(segment)
    else groups.push([segment])
  }
  const allGroups = groups

  const plansByGroup = await mapWithConcurrency(allGroups, MAX_PARALLEL_REQUESTS, async (citySegments) => {
    const groupTotalDays = groupDays(citySegments)
    // Any one segment in the group describes the same real city as every
    // other — the first is as good a representative as any for the
    // destination text/context this group's single zone-planning call needs.
    const representative = citySegments[0]!
    // A flight only ever lands/departs on the whole trip's real first/last
    // absolute day — never a per-group one — so only the group that
    // actually owns that day gets a flight line in its own zone plan.
    // `some` (not indexing citySegments[0]/[-1]) sidesteps needing to prove
    // this group's own segment ordering: whichever segment covers absolute
    // day 1 is provably the earliest-appearing one in THIS group's own
    // (still-sorted) filtered list — `segments` is chronological and
    // grouping only ever appends in that same order — so its own
    // group-relative day always comes out to 1 once groupStartDay's cursor
    // below reaches it; the same reasoning makes the absolute-last-day
    // segment's own group-relative day always this group's own
    // groupTotalDays (its last day too).
    // Gated on input.arrivalTime/departureTime actually being set, not just
    // on this group owning the day — the day-membership check alone is true
    // for every trip's first/last group regardless of whether the user ever
    // entered a flight time, which would otherwise send arrivalDay/
    // departureDay with no matching time and interpolate the literal string
    // "undefined" into buildZonePlanPrompt's Chinese text for the vast
    // majority of ordinary trips that don't set one.
    const arrivalDay = input.arrivalTime && citySegments.some((segment) => segment.startDay === 1) ? 1 : undefined
    const departureDay = input.departureTime && citySegments.some((segment) => segment.endDay === totalTripDays) ? groupTotalDays : undefined
    const { zones, cityCenter } = await planZones(
      {
        destination: representative.destination,
        travelStyle: input.travelStyle,
        preferences: preferencesForGroup(input.preferences, citySegments, allGroups),
        additionalNotes: input.additionalNotes,
        arrivalDay,
        arrivalTime: arrivalDay ? input.arrivalTime : undefined,
        departureDay,
        departureTime: departureDay ? input.departureTime : undefined,
      },
      groupTotalDays,
    )

    // Distributes the group's shared zones/cityCenter across each of its
    // segments' own slice of the group's cumulative day range — citySegments
    // is already in chronological (ascending startDay) order, since
    // `segments` itself is and groups only ever append.
    let cursor = 0
    return citySegments.map((segment): SegmentPlan => {
      const segmentDays = segment.endDay - segment.startDay + 1
      const groupStartDay = cursor + 1
      cursor += segmentDays
      return { segment, groupDestination: representative.destination, segmentDays, groupStartDay, groupTotalDays, zones, cityCenter }
    })
  })

  return plansByGroup.flat()
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
// `day`/`cityTotalDays` sent to the server are relative to the CITY GROUP
// (e.g. "day 4 of 5" for a Tokyo day that's actually the first day of its
// SECOND visit, after an earlier 3-day stay), not absolute trip day numbers
// — Claude uses them to gauge how deep into this city's overall
// relationship with the traveler it is (buildDayPrompt's "這是一趟共 X 天
// 行程裡的第 Y 天" framing), which is both more accurate (they really have
// been to this city for 3 days already) and consistent with how zone
// planning already treated this same day (see planCitySegments).
// `absoluteDay`/`totalTripDays` are used ONLY to decide whether this
// request is the one that gets arrivalTime/departureTime (those are real
// clock times tied to the whole trip's actual first/last day, not whichever
// city happens to be visited first/last) — every returned place gets
// re-tagged from the group-relative day the server force-corrected it to
// (see api/generate-trip-day.ts) back to `absoluteDay` before resolving, so
// callers merging this into a trip-wide place list never see the relative
// numbering at all.
type RequestDayParams = {
  input: CreateTripInput
  segmentDestination: string
  absoluteDay: number
  totalTripDays: number
  relativeDay: number
  cityTotalDays: number
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
  cityTotalDays,
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
        totalDays: cityTotalDays,
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
        // last day, not a per-city-group one.
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

// Which plan an absolute day number belongs to — delegates the actual "day
// falls in this segment's inclusive range" lookup (plus its largest-endDay
// fallback) to generateTrip.ts's shared segmentForDay, then maps the
// matched CitySegment back to the SegmentPlan wrapping it (by reference —
// segmentForDay always returns one of the exact CitySegment objects handed
// to it, never a copy, so `===` is reliable here). segmentForDay's fallback
// choosing the largest endDay (NOT plans[plans.length - 1]) matters
// specifically because `plans` is planCitySegments' own per-CITY grouping
// flattened back out, so its array order follows first-occurrence-of-each-
// city order, not calendar day order (a revisited city's later occurrence
// can land earlier in `plans` than an unrelated city seen only once, in
// between) — a last-array-element fallback would silently resolve to the
// wrong segment for a day past every real range on a trip that revisits a
// city.
function planForDay(plans: SegmentPlan[], absoluteDay: number): SegmentPlan {
  const segment = segmentForDay(plans.map((plan) => plan.segment), absoluteDay)
  return plans.find((plan) => plan.segment === segment)!
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
    // This day's position within its own segment's absolute range, offset
    // by that segment's own start within the GROUP's cumulative day count —
    // e.g. absolute day 6, segment.startDay=6, groupStartDay=4 (this
    // segment is the group's second occurrence, itself starting at group-
    // relative day 4) => group-relative day 4 + (6-6) = 4.
    const groupRelativeDay = plan.groupStartDay + (absoluteDay - plan.segment.startDay)
    return requestDay({
      input,
      segmentDestination: plan.groupDestination,
      absoluteDay,
      totalTripDays,
      relativeDay: groupRelativeDay,
      cityTotalDays: plan.groupTotalDays,
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
// cities (rare, but e.g. a landmark visible/listed from both a lakeside city
// and its neighbor) still dedups correctly here — placeId identifies the
// real-world location regardless of which city's request found it. A trip
// revisiting the same CITY twice (Tokyo → Kyoto → Tokyo) no longer relies on
// this function to arbitrate between two independently-converging zone
// plans — planCitySegments plans that whole city as ONE coherent multi-day
// visit up front (see its own comment), so there's no separate "earlier
// occurrence" for a later day to collide with in the first place. This dedup
// remains the backstop for whatever else might still coincide (verification
// noise, a genuinely popular landmark two different day-generation calls
// both independently reach for), same as it always was for any two days.
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
// functions calling Claude Sonnet + Google Places) — once per CITY GROUP for
// zone-planning, then once per (segment, day) for candidate generation. See
// this file's top comment for how a multi-city trip fans out into
// independent per-city plans. Returns undefined — never throws — only when
// the result is genuinely empty after both the initial pass and the one
// backfill round below. trips.ts's createTrip() treats undefined as a hard
// failure and shows a retry prompt instead of falling back to local template
// data, so this function must not report success on a fully empty result.
export async function fetchAiPlaces(
  input: CreateTripInput,
  days: number,
  baseWindow: DayWindow,
): Promise<PlaceSuggestion[] | undefined> {
  const segments = resolveCitySegments(input, days)
  const plans = await planCitySegments(input, segments, days)

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
  // ordinary verification attrition. Reuses each day's group's already-
  // planned zones/cityCenter (via `plans`) rather than re-planning.
  const shortDays = daysNeedingBackfill(merged, days, windowForDay)
  if (shortDays.length > 0) {
    const backfillPlaces = await fetchDays(input, plans, shortDays, days, windowForDay, (day) => findExistingAnchor(merged, day))
    merged = dedupeByPlaceId([...merged, ...backfillPlaces])
  }

  // A whole segment (day range) with zero places despite having at least one
  // day actually worth requesting means AI generation systematically failed
  // for that specific stretch — not just ordinary per-day verification
  // attrition, which the "a short day is legitimate" philosophy above
  // already tolerates for individual days within an otherwise-working
  // segment. Without this, a trip where one segment's day-requests all
  // failed (while other segments succeeded) would still report success —
  // merged.length > 0 from the OTHER segments alone — silently shipping a
  // trip with part of it blank instead of surfacing the retry prompt
  // createTrip() shows on failure. A segment whose every day legitimately
  // has a zero-length window (fully consumed by a flight/transit narrowing,
  // e.g. a 1-day stopover with no usable hours) is NOT a failure — there was
  // nothing to request in the first place. For a single-segment
  // (single-destination) trip this can only ever agree with the plain
  // merged.length check below, since one segment spanning every day means
  // "this segment has no places" and "the whole trip has no places" are the
  // same statement.
  const failedSegment = plans.some((plan) => {
    const segmentDayNumbers = Array.from({ length: plan.segmentDays }, (_, i) => plan.segment.startDay + i)
    const hasRequestableDay = segmentDayNumbers.some((day) => targetCountForWindow(windowForDay(day)) > 0)
    if (!hasRequestableDay) return false
    return !merged.some((place) => typeof place.day === 'number' && place.day >= plan.segment.startDay && place.day <= plan.segment.endDay)
  })

  return merged.length > 0 && !failedSegment ? merged : undefined
}
