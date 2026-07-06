export type TripStatus = 'active' | 'planning' | 'done'

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
  type: 'planning' | 'day' | 'done'
  dayNumber?: number
  placeIds: string[]
}

export type TripSummary = {
  id: string
  title: string
  destination: string
  status: TripStatus
  days: number
  travelers: number
  budget: string
  placeCount: number
  progress: number
  color: string
  imageGradient: string
}

export type Trip = TripSummary & {
  dateRange: string
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

export type Stat = {
  id: string
  label: string
  value: string
  helper: string
  helperTone: 'positive' | 'neutral'
  tone: 'brand' | 'culture' | 'coral' | 'stay'
  icon: 'compass' | 'calendar' | 'pin' | 'dollar'
}
