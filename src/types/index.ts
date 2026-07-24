export type TripPace = 'relaxed' | 'balanced' | 'packed'

export type PlaceCategory =
  | 'food'
  | 'cafe'
  | 'shopping'
  | 'culture'
  | 'nature'
  | 'museum'
  | 'transport'
  | 'stay'
  | 'activity'
  | 'other'

export type PlaceScheduleMode = 'duration' | 'departure'

export type TravelMode = 'driving' | 'walking' | 'cycling' | 'manual'

export type TravelToNext = {
  // Which place this describes travel to — lets consumers detect a stale
  // entry after reordering (the stored place is no longer actually next)
  // without needing to proactively scrub every place on every reorder.
  toPlaceId: string
  mode: TravelMode
  durationMin: number
  distanceKm?: number
}

export type TripColumn = {
  id: string
  title: string
  dayNumber: number
  placeIds: string[]
}

export type TripSummary = {
  id: string
  title: string
  destination: string
  days: number
  travelers: number
  placeCount: number
  color: string
  imageGradient: string
}

export type Trip = TripSummary & {
  dateRange: string
  // ISO date (YYYY-MM-DD) for Day 1 — lets each column compute its own
  // calendar date instead of just a "Day N" label. Optional because
  // AI-generated trips don't collect a start date yet.
  startDate?: string
  preferences: string[]
  pace: TripPace
  columns: TripColumn[]
}

// A curated sample itinerary shown on the Explore page — same shape as Trip
// minus the date fields (templates aren't scheduled), plus a one-line pitch.
export type ExploreTemplate = Omit<Trip, 'dateRange' | 'startDate'> & {
  tagline: string
}

export type Place = {
  id: string
  tripId: string
  name: string
  category: PlaceCategory
  estimatedTime: number
  address: string
  lat: number
  lng: number
  description: string
  travelTip?: string
  // English/local-language name used for the initial geocode lookup instead
  // of `name` (which is Traditional Chinese by design) — see PlaceSuggestion
  // in generateTrip.ts. Only set for AI-suggested places.
  geocodeQuery?: string
  // Retried if geocodeQuery's lookup comes back empty — see PlaceSuggestion.
  geocodeQueryAlt?: string
  // Manual arrival-time override ('HH:mm'). When unset, the effective
  // arrival time cascades from the place before it — see computeArrivalTimes.
  arrivalTime?: string
  // The two values are stored independently. scheduleMode only chooses which
  // one represents the place on its card and drives the following arrival.
  scheduleMode?: PlaceScheduleMode
  departureTime?: string
  columnId: string
  imageGradient: string
  // Travel from this place to whichever place follows it in the same day —
  // absent until calculated (see routing.ts / trips store's auto-fill).
  travelToNext?: TravelToNext
}

export type CreateTripInput = {
  destination: string
  // ISO dates (YYYY-MM-DD) — trip length is derived from the gap between them
  // rather than collected as its own field.
  startDate: string
  endDate: string
  travelers: number
  // Up to 2 selected style archetypes (e.g. 精準規劃/自在慢旅) — plural because
  // the form allows a 2-select combination whose paces get averaged (see
  // paceForTravelStyles in generateTrip.ts), not a single free-text style.
  travelStyle: string[]
  // Free-text catch-all for anything the structured fields don't cover —
  // places to avoid, but just as often a positive request (dietary needs, "want
  // a beach day", traveling with kids) — see api/_lib/tripGen.ts's prompt
  // for why it's framed neutrally rather than as an exclusion list.
  additionalNotes: string
  preferences: string[]
}
