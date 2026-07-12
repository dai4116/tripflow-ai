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

export type Stat = {
  id: string
  label: string
  value: string
  helper: string
  helperTone: 'positive' | 'neutral'
  tone: 'brand' | 'culture' | 'coral' | 'stay'
  icon: 'compass' | 'calendar' | 'pin' | 'dollar'
}
