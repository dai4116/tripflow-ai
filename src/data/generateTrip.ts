import { nanoid } from 'nanoid'
import { addMinutes, clockTimeToMinutes } from './placeSchedule.ts'
import type { CreateTripInput, Place, PlaceCategory, Trip, TripColumn, TripPace } from '../types'

// A day's active-hours window, 'HH:mm' local time. Exported so
// aiTripClient.ts can share this instead of redeclaring the same shape.
export type DayWindow = { start: string; end: string }

const TRIP_PALETTE = ['#e8618c', '#00c5ab', '#d98324', '#4a7de0']

// Distinct per-day colors for the trip map (pins + route line) — reused
// from colors already used elsewhere in the app (TRIP_PALETTE) rather than
// inventing a new set, so the map stays visually consistent with the rest of
// the UI instead of introducing its own palette. Cycles for trips longer
// than 6 days.
export const DAY_COLORS = ['#00c5ab', '#4a7de0', '#d98324', '#8161e6', '#4d9166', '#e8618c']

export function dayColorForIndex(index: number): string {
  return DAY_COLORS[index % DAY_COLORS.length]!
}

// Each style's own pace bucket — single-select now (see CreateTripPage.vue),
// so this is a direct style -> pace lookup, no averaging needed. Preserves
// the same effective mapping the old evenly-spaced place-count numbers
// implied (精準規劃/熱血冒險 -> packed, 深度探索 -> balanced, 自在慢旅 ->
// relaxed).
const TRAVEL_STYLE_PACE: Record<string, TripPace> = {
  精準規劃: 'packed',
  自在慢旅: 'relaxed',
  深度探索: 'balanced',
  熱血冒險: 'packed',
}

// Resolves the selected travel style into a pace. Single-select means at
// most one style is ever passed in; falls back to 'balanced' when nothing
// resolves (no selection, or an unrecognized style name) rather than
// propagating undefined.
export function paceForTravelStyles(travelStyles: string[]): TripPace {
  return TRAVEL_STYLE_PACE[travelStyles[0] ?? ''] ?? 'balanced'
}

// When a day's active hours run, by pace. Both ends matter, not just the
// length: `start` is also the hour the rendered schedule cascades from (see
// computeArrivalTimes' dayStartTime in placeSchedule.ts), so relaxed starting
// at 10:00 is what actually gives a 自在慢旅 trip a sleep-in morning rather
// than just a shorter day. The number of places that land in a day falls out
// of this window's duration budget (see selectPlacesForWindow below) rather
// than a flat count target, so a day of quick photo stops naturally fits more
// than a day with a couple of half-day museums.
const DAY_WINDOW_BY_PACE: Record<TripPace, DayWindow> = {
  // 9 hours, the shortest of the three: a late start is what makes this pace
  // a sleep-in, but the day still has to stay sparser than balanced's — an
  // earlier 10:00-20:00 version pushed relaxed to a 10-hour day, which
  // silently gave it the same place count as balanced (6) and left the two
  // paces differing only in what time they began.
  relaxed: { start: '10:00', end: '19:00' },
  balanced: { start: '08:00', end: '19:00' },
  packed: { start: '08:00', end: '21:00' },
}

export function dayWindowForPace(pace: TripPace): DayWindow {
  return DAY_WINDOW_BY_PACE[pace]
}

// Customs/immigration + getting from the airport into the city (arrival), or
// getting back to the airport in time (departure) — an itinerary's places
// don't realistically start/end right at the gate.
const AIRPORT_BUFFER_MIN = 90

function minutesToHHMM(minutes: number): string {
  const clamped = Math.max(0, Math.round(minutes))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

// Deliberately NOT placeSchedule.ts's addMinutes/minutesBetween, which wrap
// past midnight (meant for a stay crossing into the next day). The values
// here are one-off window boundaries for a single same-day calculation — a
// buffered arrival of 23:00+90min must stay "1470", further past the
// window's end, not wrap around to "00:30" and read as EARLY in the day (a
// real bug in an earlier version of this file's ratio-based scaling).
// Deliberately left un-clamped to [0, 1439] — minutesAvailable below clamps
// the final availability to >= 0, which is all that actually matters here.
function minutesAvailable(startMinutes: number, endMinutes: number): number {
  return Math.max(0, endMinutes - startMinutes)
}

// Narrows a day's window when that day is shortened by a flight — day 1 by a
// late arrival, the trip's last day by an early departure (both, for a
// one-day trip with both set). Every other day is untouched. Simpler than
// the count-scaling this replaced: there's no "full baseline" to scale a
// count against anymore, since the window itself now IS the baseline — this
// just clips it directly against the flight buffer.
export function windowForFlightDay(
  baseWindow: DayWindow,
  dayNumber: number,
  totalDays: number,
  input: Pick<CreateTripInput, 'arrivalTime' | 'departureTime'>,
): DayWindow {
  const isFlightDay = (dayNumber === 1 && input.arrivalTime) || (dayNumber === totalDays && input.departureTime)
  if (!isFlightDay) return baseWindow

  const startMinutes =
    dayNumber === 1 && input.arrivalTime
      ? Math.max(clockTimeToMinutes(baseWindow.start), clockTimeToMinutes(input.arrivalTime) + AIRPORT_BUFFER_MIN)
      : clockTimeToMinutes(baseWindow.start)
  const endMinutes =
    dayNumber === totalDays && input.departureTime
      ? Math.min(clockTimeToMinutes(baseWindow.end), clockTimeToMinutes(input.departureTime) - AIRPORT_BUFFER_MIN)
      : clockTimeToMinutes(baseWindow.end)

  // A zero/negative-length window means the flight leaves no usable time at
  // all — callers (targetCountForWindow, aiTripClient.ts) must treat that as
  // "skip this day", not "at least one place", same as the old design's
  // count-of-0 convention.
  if (endMinutes <= startMinutes) return { start: baseWindow.start, end: baseWindow.start }
  return { start: minutesToHHMM(startMinutes), end: minutesToHHMM(endMinutes) }
}

// Assumed minutes per stop (typical duration + a travel allowance), used
// only to size a SOFT candidate-count guide sent to the AI prompt — the real
// per-day place count falls out of the duration-budget walk in the columns
// loop below, once actual estimatedTimeHours values are known. 105 min/stop
// keeps the resulting targets (relaxed~5, balanced~6, packed~7) close to the
// old flat 3/4/5 counts, so over-ask sizing and server verification
// throughput don't need retuning.
const ASSUMED_MINUTES_PER_STOP = 105
const HARD_MAX_PLACES_PER_DAY = 7

// The shortest a single place's clamped duration can ever be (see
// MIN_ESTIMATED_HOURS below, shared here so both agree on what "too short
// for even one stop" means) — declared before resolveEstimatedTime since
// targetCountForWindow needs it too. 1 hour, not something smaller: a real
// stop (food/attraction/shopping) realistically never wraps up in under an
// hour once you count actually being there, not just the "typical visit"
// number an AI might give for a quick photo spot. This also raises
// targetCountForWindow's "too short to fit even one place" floor from 30 to
// 60 minutes — deliberate, since a window that can't fit a full hour
// shouldn't have a place forced into it either.
const MIN_ESTIMATED_HOURS = 1
const MAX_ESTIMATED_HOURS = 6

// Every resolved duration is rounded UP to the nearest half hour (never
// down) — an AI estimate like "1.2 hours" displaying as "1 時 12 分" reads as
// falsely precise; itinerary stay times are inherently rough guesses, so
// they should look like one (1, 1.5, 2h, ...) rather than an oddly specific
// number of minutes.
const ESTIMATED_HOURS_ROUNDING_STEP = 0.5

// A window shorter than the shortest possible single stop isn't just
// "round(minutes/105) happens to hit 0" — it's genuinely too short for even
// one place, and must be treated the same as a fully zero-length window
// (skip this day), not floored back up to 1. Without this, windowForFlightDay
// only collapses a window to zero-length once the flight buffer fully
// overtakes it — a tiny surviving sliver (e.g. 5 minutes left after a late
// arrival's 90-minute buffer) would otherwise still report a target of 1,
// and the columns loop's "always keep at least one place" rule would then
// force a full-length place into a window that can't actually fit it.
export function targetCountForWindow(window: DayWindow): number {
  const minutes = minutesAvailable(clockTimeToMinutes(window.start), clockTimeToMinutes(window.end))
  if (minutes < MIN_ESTIMATED_HOURS * 60) return 0
  return Math.max(1, Math.min(HARD_MAX_PLACES_PER_DAY, Math.round(minutes / ASSUMED_MINUTES_PER_STOP)))
}

// Places that are "fixed obligations, not a budgeted experience" (see
// isRouteAnchor in AskAiPanel.vue, which excludes the same two categories
// from AI route-reordering for the same reason) always use a small fixed
// duration rather than the AI's estimate — a hotel check-in or a transit
// leg isn't something to budget real sightseeing time against.
const FIXED_OBLIGATION_CATEGORIES: PlaceCategory[] = ['stay', 'transport']

const DEFAULT_DURATION_BY_CATEGORY: Record<PlaceCategory, number> = {
  food: 1,
  attraction: 1.5,
  shopping: 1,
  stay: 0.5,
  transport: 0.25,
  other: 1,
}

// Resolves a place's stay duration: the AI's own estimate (see
// estimatedTimeHours in api/_lib/tripGen.ts's PLACE_SCHEMA), clamped to a
// sane range and rounded up to a clean half-hour, or a per-category default
// when there's no AI estimate at all (manually-added places) or the value is
// missing/invalid — the defaults are already clean, in-range numbers, so they
// skip the rounding step. stay/transport always use their fixed default
// regardless of any AI value — see FIXED_OBLIGATION_CATEGORIES above.
export function resolveEstimatedTime(category: PlaceCategory, aiHours?: number): number {
  if (FIXED_OBLIGATION_CATEGORIES.includes(category)) return DEFAULT_DURATION_BY_CATEGORY[category]
  if (typeof aiHours === 'number' && Number.isFinite(aiHours)) {
    const clamped = Math.min(MAX_ESTIMATED_HOURS, Math.max(MIN_ESTIMATED_HOURS, aiHours))
    return Math.ceil(clamped / ESTIMATED_HOURS_ROUNDING_STEP) * ESTIMATED_HOURS_ROUNDING_STEP
  }
  return DEFAULT_DURATION_BY_CATEGORY[category]
}

export type PlaceSuggestion = {
  category: PlaceCategory
  name: string
  description: string
  // English/local-language search string for the geocoder — the display
  // `name` is Traditional Chinese by design (see the AI prompts), which
  // OpenStreetMap/Nominatim usually can't match for places outside
  // Chinese-speaking regions. Absent for locally-templated suggestions,
  // which fall back to geocoding by `name`.
  geocodeQuery?: string
  // Shorter/more common alternate phrasing of geocodeQuery, tried as a
  // retry when the AI's guessed "official" name doesn't match what the map
  // provider actually has on record (e.g. a compound name it assembled
  // itself, vs. the shorter name OSM is indexed under).
  geocodeQueryAlt?: string
  // Authoritative coordinates + Google Places id, present when the place was
  // verified server-side against Google Places (see api/_lib/placesVerify.ts).
  // When set, the place is placed on the map directly with no client-side
  // geocoding. Absent only on the no-Google-key interim path, where the
  // client still falls back to Nominatim (see geocodeNewPlaces in trips.ts).
  lat?: number
  lng?: number
  placeId?: string
  // Google Places photo resource name, carried through from verification —
  // see the matching field on Place in types/index.ts.
  photoRef?: string
  // Which trip day (1-indexed) this suggestion belongs to, set by the AI and
  // preserved through server-side verification (see
  // api/generate-trip-day.ts).
  // generateTrip() groups by this field rather than by array position —
  // position-based day-chunking broke once verification could drop an
  // arbitrary subset of candidates: a shortfall early in the flat array
  // shifted every later position, and once the array ran out, every
  // remaining day silently came up empty. Absent for locally-templated
  // suggestions (AddPlaceModal), which don't belong to a generated trip.
  day?: number
  // AI-supplied guess at when this place is typically/best visited (a night
  // market is 'evening', a large mall is 'anytime') — drives orderDayPlaces
  // below. Absent for locally-templated suggestions, which orderDayPlaces
  // treats the same as 'anytime' (no ordering opinion).
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'anytime'
  // AI-supplied guess at typical visitor stay length in hours — see
  // resolveEstimatedTime, which clamps/falls back on this. Optional (rather
  // than trusting the schema's `required` at face value) since this crosses
  // a network boundary — a truncated stream or a future model revision could
  // still omit it in practice. Absent for locally-templated suggestions.
  estimatedTimeHours?: number
}

// Trip/template destinations are free text like "京都，日本" — the part
// before the comma is what geocoding and city-flavored copy actually want.
export function cityFromDestination(destination: string): string {
  return destination.split(/[,，]/)[0].trim() || destination
}

// The part after the first comma (e.g. "日本" from "京都，日本") — dropped by
// cityFromDestination, but useful as extra geocoding context so a place
// query isn't just matched against a bare city name with no country to
// disambiguate same-named places elsewhere in the world.
export function regionFromDestination(destination: string): string {
  const [, ...rest] = destination.split(/[,，]/)
  return rest.join(',').trim()
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trip'
}

// Trip length counts inclusive calendar days, not nights — Mar 15 to Mar 22
// is an 8-day trip (both ends count), matching how each day gets its own
// kanban column (see columnDate in TripBoardPage.vue, which dates column N
// as startDate + (N - 1) — the same +1-inclusive convention).
function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

// Exported so callers can size an AI place request (days * dayWindowForPace(pace))
// before the deterministic trip scaffolding runs, without duplicating the clamp logic.
// Takes just the date fields (not the full CreateTripInput) so the create-trip
// form can also use it to preview the day count before submitting.
export function computeTripDays(input: Pick<CreateTripInput, 'startDate' | 'endDate'>): number {
  return Math.max(1, Math.min(30, daysBetween(input.startDate, input.endDate) || 7))
}

// YYYY-MM-DD in local time — Date#toISOString() is UTC and can land on the
// wrong calendar day depending on the caller's timezone offset.
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const startLabel = start.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' })
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  const endLabel = sameMonth ? `${end.getDate()}日` : end.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' })

  return `${end.getFullYear()}年${startLabel} - ${endLabel}`
}

type GeoPoint = { lat: number; lng: number }

function hasCoords(suggestion: PlaceSuggestion): suggestion is PlaceSuggestion & GeoPoint {
  return typeof suggestion.lat === 'number' && typeof suggestion.lng === 'number'
}

// Haversine distance in km. Duplicated from api/_lib/placesVerify.ts's
// identical formula rather than imported — api/ and src/ are independent
// deployable units (same reasoning as the mapWithConcurrency/PLACE_CATEGORIES
// copies already split that way elsewhere in this codebase).
function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

// 'anytime' shares 'afternoon''s weight — no strong timing opinion reads as
// flexible middle-of-day filler, not as its own separate slot.
const TIME_BUCKET_WEIGHT: Record<string, number> = { morning: 0, afternoon: 1, anytime: 1, evening: 2 }

// Orders a day's places into a same-day-sensible sequence instead of
// whatever order they happened to survive AI generation + verification in.
// Two passes: group by time-of-day bucket first (morning before afternoon
// before evening) — this has to come first because computeArrivalTimes
// (placeSchedule.ts) turns display order directly into clock times starting
// at 08:00, so a night-market-type place landing early in the array would
// show an absurd morning arrival time. Within each bucket, chain by nearest
// neighbor (greedy, not true shortest-path — overkill for the 3-5 stops a
// day actually has) so the route itself doesn't zigzag. Places missing
// coordinates (the no-Google-key fallback path) just keep their relative
// order within their bucket, since there's nothing to measure distance from.
function orderDayPlaces(suggestions: PlaceSuggestion[]): PlaceSuggestion[] {
  if (suggestions.length <= 1) return suggestions

  const buckets = new Map<number, PlaceSuggestion[]>()
  for (const suggestion of suggestions) {
    const weight = TIME_BUCKET_WEIGHT[suggestion.timeOfDay ?? 'anytime'] ?? TIME_BUCKET_WEIGHT.afternoon!
    const bucket = buckets.get(weight) ?? []
    bucket.push(suggestion)
    buckets.set(weight, bucket)
  }

  const ordered: PlaceSuggestion[] = []
  let current: GeoPoint | null = null
  for (const weight of [...buckets.keys()].sort((a, b) => a - b)) {
    const remaining = buckets.get(weight)!
    while (remaining.length > 0) {
      let nextIndex = 0
      if (current) {
        let bestDistance = Infinity
        for (let i = 0; i < remaining.length; i++) {
          const candidate = remaining[i]!
          if (!hasCoords(candidate)) continue
          const distance = distanceKm(current, candidate)
          if (distance < bestDistance) {
            bestDistance = distance
            nextIndex = i
          }
        }
      }
      const [next] = remaining.splice(nextIndex, 1)
      ordered.push(next!)
      if (hasCoords(next!)) current = { lat: next!.lat, lng: next!.lng }
    }
  }
  return ordered
}

// A flat assumed gap between consecutive stops (typical short transit/buffer
// time), used only to decide which suggestions fit a day's window — not the
// real routed travel time placeSchedule.ts's computeArrivalTimes uses for
// the actual displayed schedule (via travelToNext, defaulting to 0 when not
// yet known). The two are intentionally separate: this one sizes generation
// before any place is geocoded or routed, that one renders the real result
// once it is.
const INTER_STOP_BUFFER_MIN = 25

// Pure selection: which of a day's ordered suggestions (see orderDayPlaces)
// actually get used, given its active-hours window and each one's real
// estimated duration. Kept separate from addPlace's side effect (mutating
// the outer `places` array) so "which places fit this window" is a decision
// that can be reasoned about — and tested — on its own.
export function selectPlacesForWindow(dayPlaces: PlaceSuggestion[], dayWindow: DayWindow): PlaceSuggestion[] {
  // A window too short to fit even one place at all (see
  // targetCountForWindow's own floor) skips selection entirely rather than
  // reaching the "keep at least one" rule below — windowForFlightDay's own
  // contract is that callers treat that case as "skip this day," and this
  // function is exported/usable standalone, so it can't rely on the caller
  // (aiTripClient.ts) having already honored that contract by never sending
  // suggestions for such a day.
  if (targetCountForWindow(dayWindow) === 0) return []

  const windowEndMinutes = clockTimeToMinutes(dayWindow.end)
  let cursorMinutes = clockTimeToMinutes(dayWindow.start)
  const selected: PlaceSuggestion[] = []
  for (const suggestion of dayPlaces) {
    if (selected.length >= HARD_MAX_PLACES_PER_DAY) break
    const hours = resolveEstimatedTime(suggestion.category, suggestion.estimatedTimeHours)
    const projectedEndMinutes = cursorMinutes + hours * 60
    // Never produce an empty day just because the very first candidate alone
    // overshoots the window — always keep at least one place if any exist,
    // same "a short day is legitimate" logic this file has always used for
    // verification shortfalls.
    if (selected.length > 0 && projectedEndMinutes > windowEndMinutes) break
    selected.push(suggestion)
    cursorMinutes = projectedEndMinutes + INTER_STOP_BUFFER_MIN
  }
  return selected
}

// aiPlaces (merged from many /api/generate-trip-day requests — see
// aiTripClient.ts) supplies the
// name/category/description for each place, in visit order, and —
// when verified server-side against Google Places — its coordinates too. All
// other bookkeeping (ids, palette color, estimatedTime/cost) stays local
// rather than trusting the model for facts it can't actually know. Days are
// built purely from aiPlaces; a slot with no suggestion is left empty rather
// than backfilled (see the columns loop).
//
// baseWindow accepts an override so the one real caller (trips.ts's
// createTrip, which already computes it to size the AI request) can pass
// the exact window it used instead of this function re-deriving an identical
// one a moment later from the same input — two calls to the same pure
// function currently agree, but only by coincidence of both reading
// input.travelStyle the same way; passing it through removes that
// coincidence as a requirement. Left optional (falling back to the same
// computation) so this function stays usable standalone, e.g. in tests.
export function generateTrip(
  input: CreateTripInput,
  existingTripIds: string[],
  aiPlaces?: PlaceSuggestion[],
  baseWindow?: DayWindow,
): { trip: Trip; places: Place[] } {
  const city = cityFromDestination(input.destination)
  const days = computeTripDays(input)
  const pace = paceForTravelStyles(input.travelStyle)
  const resolvedWindow = baseWindow ?? dayWindowForPace(pace)
  const tripId = `${slugify(input.destination)}-${nanoid(6)}`
  const color = TRIP_PALETTE[existingTripIds.length % TRIP_PALETTE.length]!

  const places: Place[] = []

  function addPlace(suggestion: PlaceSuggestion, columnId: string): Place {
    const place: Place = {
      id: nanoid(8),
      tripId,
      name: suggestion.name,
      category: suggestion.category,
      estimatedTime: resolveEstimatedTime(suggestion.category, suggestion.estimatedTimeHours),
      address: input.destination,
      // Coordinates come from the suggestion when it was verified server-side
      // against Google Places (the normal path — the place is pinned on the
      // map immediately). They're 0,0 only on the no-Google-key interim path,
      // where the trips store still geocodes via Nominatim in the background
      // (see geocodeNewPlaces in stores/trips.ts).
      lat: suggestion.lat ?? 0,
      lng: suggestion.lng ?? 0,
      description: suggestion.description,
      geocodeQuery: suggestion.geocodeQuery,
      geocodeQueryAlt: suggestion.geocodeQueryAlt,
      columnId,
      photoRef: suggestion.photoRef,
      placeId: suggestion.placeId,
    }
    places.push(place)
    return place
  }

  // "抵達機場"/"前往機場" — a real, editable Place card for a known flight
  // time (see the columns loop below), not AI-suggested and not geocoded:
  // a wrong-but-confident pin for a guessed airport name would be worse
  // than the no-pin fallback every other ungeocoded place already degrades
  // to (see hasCoords in stores/trips.ts). skipGeocode tells
  // geocodeNewPlaces to actually honor that and not fall back to guessing
  // coordinates from the literal name — cleared by updatePlace once the
  // user renames the card to something specific. `arrivalTime` is set
  // manually, which is all computeArrivalTimes needs to treat this like any
  // other manually-timed card — the arrival card's estimatedTime supplies
  // the customs/transit buffer that pushes every place after it later, and
  // the departure card's buffered arrivalTime is what the cascade's existing
  // overlap check compares later cards against, surfacing a "won't make the
  // flight" warning for free.
  function addFlightPlace(name: string, description: string, arrivalTime: string, estimatedTime: number, columnId: string): Place {
    const place: Place = {
      id: nanoid(8),
      tripId,
      name,
      category: 'transport',
      estimatedTime,
      address: input.destination,
      lat: 0,
      lng: 0,
      description,
      arrivalTime,
      columnId,
      skipGeocode: true,
    }
    places.push(place)
    return place
  }

  // Group by the suggestion's own `day` tag rather than flat array position.
  // Position-based slicing broke once server-side verification could drop an
  // arbitrary subset of candidates: a shortfall on an early day shifted every
  // later position, and once the array ran dry every remaining day came up
  // silently empty (confirmed live — a 7-day trip lost days 4-7 this way).
  // Grouping by `day` scopes each day's shortfall to itself. Suggestions
  // with no `day` (or one outside 1..days) are dropped rather than guessed.
  const suggestionsByDay = new Map<number, PlaceSuggestion[]>()
  for (const suggestion of aiPlaces ?? []) {
    if (typeof suggestion.day !== 'number' || suggestion.day < 1 || suggestion.day > days) continue
    const list = suggestionsByDay.get(suggestion.day) ?? []
    list.push(suggestion)
    suggestionsByDay.set(suggestion.day, list)
  }

  const columns: TripColumn[] = Array.from({ length: days }, (_, index) => {
    const dayNumber = index + 1
    const columnId = `day-${dayNumber}`
    const dayPlaces = orderDayPlaces(suggestionsByDay.get(dayNumber) ?? [])
    // Day 1 / the last day get a narrower window than resolvedWindow when a
    // flight arrival/departure shortens their usable hours — see
    // windowForFlightDay. Every other day is untouched.
    const dayWindow = windowForFlightDay(resolvedWindow, dayNumber, days, input)
    // Which of this day's places actually get used — driven by the window's
    // real duration budget, not a flat per-day count — see
    // selectPlacesForWindow. Days are still built ONLY from real (AI +
    // server-verified) suggestions; a day just ends whenever its own
    // suggestions or its time budget runs out, whichever comes first.
    const placeIds = selectPlacesForWindow(dayPlaces, dayWindow).map((suggestion) => addPlace(suggestion, columnId).id)

    // Prepend/append a real flight card rather than writing an invisible
    // per-day schedule override — unshift/push happen outside orderDayPlaces
    // (called above, only over the AI suggestions) so a flight card is never
    // reshuffled into the middle of the day by its time-of-day/nearest-
    // neighbor ordering.
    if (dayNumber === 1 && input.arrivalTime) {
      const arrivalPlace = addFlightPlace(
        '抵達機場',
        '入境、領行李、前往市區的預留時間',
        input.arrivalTime,
        AIRPORT_BUFFER_MIN / 60,
        columnId,
      )
      placeIds.unshift(arrivalPlace.id)
    }
    if (dayNumber === days && input.departureTime) {
      const departurePlace = addFlightPlace(
        '前往機場',
        `航班表定 ${input.departureTime} 起飛，建議提前抵達機場辦理登機`,
        addMinutes(input.departureTime, -AIRPORT_BUFFER_MIN),
        AIRPORT_BUFFER_MIN / 60,
        columnId,
      )
      placeIds.push(departurePlace.id)
    }

    return { id: columnId, title: `第${dayNumber}天`, dayNumber, placeIds }
  })

  const trip: Trip = {
    id: tripId,
    title: `${city}之旅`,
    destination: input.destination,
    days,
    placeCount: places.length,
    color,
    dateRange: formatDateRange(input.startDate, input.endDate),
    startDate: input.startDate,
    destinationPlaceId: input.destinationPlaceId,
    destinationLat: input.destinationLat,
    destinationLng: input.destinationLng,
    preferences: input.preferences,
    pace,
    columns,
  }

  return { trip, places }
}
