import { nanoid } from 'nanoid'
import type { CreateTripInput, Place, PlaceCategory, Trip, TripColumn, TripPace } from '../types'

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

// Each style's own pace, expressed directly as a places-per-day number —
// not just a TripPace bucket — because multi-select (up to 2 styles) needs
// to average two styles' numbers together (see paceForTravelStyles).
// PLACES_PER_DAY's three values below are evenly spaced (3/4/5), so
// averaging the raw numbers first and mapping back to a bucket afterward
// always lands exactly on one of the three; there's no fractional pace with
// no bucket to hold it.
const TRAVEL_STYLE_PLACES_PER_DAY: Record<string, number> = {
  精準規劃: 5,
  自在慢旅: 3,
  深度探索: 4,
  熱血冒險: 5,
}

// How many places make up one day's column, by pace — a relaxed trip leaves
// more breathing room, a packed one fits more in. Days are built purely from
// AI suggestions (see the columns loop below), so whether a day actually
// includes a food-category place depends on the model following the meal-slot
// instruction in api/_lib/tripGen.ts's prompt, not on anything enforced here.
const PLACES_PER_DAY: Record<TripPace, number> = {
  relaxed: 3,
  balanced: 4,
  packed: 5,
}

export function placesPerDayForPace(pace: TripPace): number {
  return PLACES_PER_DAY[pace]
}

// Resolves the (up to 2) selected travel styles into one pace. A single
// style just uses its own number; two styles average their places-per-day
// numbers and round — e.g. 精準規劃(5) + 自在慢旅(3) averages to exactly 4
// (balanced); 精準規劃(5) + 深度探索(4) averages to 4.5, which Math.round
// takes up to 5 (packed). Falls back to 'balanced' when nothing resolves (no
// selection, or an unrecognized style name) rather than propagating NaN.
export function paceForTravelStyles(travelStyles: string[]): TripPace {
  const values = travelStyles
    .map((style) => TRAVEL_STYLE_PLACES_PER_DAY[style])
    .filter((value): value is number => value !== undefined)
  if (values.length === 0) return 'balanced'

  const averaged = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  const matchingPace = (Object.entries(PLACES_PER_DAY) as Array<[TripPace, number]>).find(
    ([, count]) => count === averaged,
  )
  return matchingPace?.[0] ?? 'balanced'
}

export type PlaceSuggestion = {
  category: PlaceCategory
  name: string
  description: string
  travelTip?: string
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

// Exported so callers can size an AI place request (days * placesPerDayForPace(pace))
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

// aiPlaces (merged from many /api/generate-trip-day requests — see
// aiTripClient.ts) supplies the
// name/category/description/travelTip for each place, in visit order, and —
// when verified server-side against Google Places — its coordinates too. All
// other bookkeeping (ids, palette color, estimatedTime/cost) stays local
// rather than trusting the model for facts it can't actually know. Days are
// built purely from aiPlaces; a slot with no suggestion is left empty rather
// than backfilled (see the columns loop).
//
// placesPerDay accepts an override so the one real caller (trips.ts's
// createTrip, which already computes it to size the AI request) can pass
// the exact value it used instead of this function re-deriving an identical
// number a moment later from the same input — two calls to the same pure
// function currently agree, but only by coincidence of both reading
// input.travelStyle the same way; passing it through removes that
// coincidence as a requirement. Left optional (falling back to the same
// computation) so this function stays usable standalone, e.g. in tests.
export function generateTrip(
  input: CreateTripInput,
  existingTripIds: string[],
  aiPlaces?: PlaceSuggestion[],
  placesPerDay?: number,
): { trip: Trip; places: Place[] } {
  const city = cityFromDestination(input.destination)
  const days = computeTripDays(input)
  const pace = paceForTravelStyles(input.travelStyle)
  const resolvedPlacesPerDay = placesPerDay ?? placesPerDayForPace(pace)
  const tripId = `${slugify(input.destination)}-${nanoid(6)}`
  const color = TRIP_PALETTE[existingTripIds.length % TRIP_PALETTE.length]!

  const places: Place[] = []

  function addPlace(suggestion: PlaceSuggestion, columnId: string): Place {
    const place: Place = {
      id: nanoid(8),
      tripId,
      name: suggestion.name,
      category: suggestion.category,
      estimatedTime: 1,
      address: input.destination,
      // Coordinates come from the suggestion when it was verified server-side
      // against Google Places (the normal path — the place is pinned on the
      // map immediately). They're 0,0 only on the no-Google-key interim path,
      // where the trips store still geocodes via Nominatim in the background
      // (see geocodeNewPlaces in stores/trips.ts).
      lat: suggestion.lat ?? 0,
      lng: suggestion.lng ?? 0,
      description: suggestion.description,
      travelTip: suggestion.travelTip,
      geocodeQuery: suggestion.geocodeQuery,
      geocodeQueryAlt: suggestion.geocodeQueryAlt,
      columnId,
      photoRef: suggestion.photoRef,
      placeId: suggestion.placeId,
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
    const placeIds: string[] = []
    for (let i = 0; i < resolvedPlacesPerDay; i++) {
      const suggestion = dayPlaces[i]
      // Days are built ONLY from real (AI + server-verified) suggestions now.
      // A slot with no suggestion is left empty rather than backfilled —
      // since createTrip verifies every place against Google Places and
      // drops any it can't find, backfilling would silently reintroduce a
      // generic/un-pinnable place, exactly what verification exists to
      // prevent. A short day just has fewer, all-real places.
      if (!suggestion) continue
      placeIds.push(addPlace(suggestion, columnId).id)
    }

    return { id: columnId, title: `第${dayNumber}天`, dayNumber, placeIds }
  })

  const trip: Trip = {
    id: tripId,
    title: `${city}之旅`,
    destination: input.destination,
    days,
    travelers: input.travelers,
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
