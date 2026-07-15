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
  estimatedCost: string
  address: string
  lat: number
  lng: number
  rating: string
  description: string
  travelTip?: string
  columnId: string
  imageGradient: string
}

export type CreateTripInput = {
  destination: string
  // ISO dates (YYYY-MM-DD) — trip length is derived from the gap between them
  // rather than collected as its own field.
  startDate: string
  endDate: string
  travelers: number
  travelStyle: string
  avoidPlaces: string
  preferences: string[]
}
