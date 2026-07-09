import { nanoid } from 'nanoid'
import type { CreateTripInput, Place, PlaceCategory, Trip, TripColumn, TripPace } from '../types'

const TRIP_PALETTE = [
  { color: '#e8618c', imageGradient: 'linear-gradient(135deg, #4a1f3d, #e8618c 50%, #f8d7e3)' },
  { color: '#00c5ab', imageGradient: 'linear-gradient(135deg, #1a3a3a, #00c5ab 50%, #d8f5ee)' },
  { color: '#d98324', imageGradient: 'linear-gradient(135deg, #3d2a12, #d98324 50%, #fbe3c2)' },
  { color: '#4a7de0', imageGradient: 'linear-gradient(135deg, #182a4d, #4a7de0 50%, #d5e2f8)' },
]

export const PLACE_GRADIENTS = [
  'linear-gradient(135deg, #18233c, #c23b5c 50%, #f1a15f)',
  'linear-gradient(135deg, #183c5d, #4a7de0 55%, #ff7a59)',
  'linear-gradient(135deg, #22465c, #d96b4b 45%, #f3d0bb)',
  'linear-gradient(135deg, #9fbf8f, #d9ecc8 55%, #f2f7e6)',
  'linear-gradient(135deg, #22303c, #8161e6 60%, #cbbcf2)',
  'linear-gradient(135deg, #2a4562, #00c5ab 45%, #f26157)',
]

const PREFERENCE_CATEGORY: Record<string, PlaceCategory> = {
  Museums: 'culture',
  Beaches: 'nature',
  Hiking: 'nature',
  'Local Food': 'food',
  Nightlife: 'activity',
  Shopping: 'shopping',
  'Art Galleries': 'culture',
  Architecture: 'culture',
  'Street Food': 'food',
  Temples: 'culture',
  Parks: 'nature',
  Markets: 'shopping',
  Cafes: 'cafe',
  Viewpoints: 'nature',
}

const TRAVEL_STYLE_CATEGORY: Record<string, PlaceCategory> = {
  Adventure: 'activity',
  Relaxation: 'nature',
  Cultural: 'culture',
  'Food & Drink': 'food',
  Photography: 'culture',
  Nature: 'nature',
}

const TRAVEL_STYLE_PACE: Record<string, TripPace> = {
  Relaxation: 'relaxed',
  Adventure: 'packed',
}

type CategoryTemplate = { name: string; description: string }

const CATEGORY_TEMPLATES: Partial<Record<PlaceCategory, (city: string) => CategoryTemplate[]>> = {
  culture: (city) => [
    { name: `${city} Old Town Walk`, description: `Wander the historic streets and landmark architecture of ${city}.` },
    { name: `${city} History Museum`, description: `A deep dive into the story and culture of ${city}.` },
    { name: `Landmark Cathedral of ${city}`, description: `One of ${city}'s most photographed architectural icons.` },
  ],
  food: (city) => [
    { name: `${city} Night Food Market`, description: `Street stalls and local specialties after dark in ${city}.` },
    { name: `Local Favorite Restaurant in ${city}`, description: 'A well-loved spot locals actually eat at.' },
    { name: `${city} Street Food Alley`, description: 'Quick bites and regional flavors, block by block.' },
  ],
  nature: (city) => [
    { name: `${city} Scenic Viewpoint`, description: `Panoramic views over ${city} — best around sunset.` },
    { name: `${city} Botanical Gardens`, description: `A quiet green escape in the middle of ${city}.` },
    { name: `Coastal Walk near ${city}`, description: 'Fresh air and open water views just outside the city.' },
  ],
  shopping: (city) => [
    { name: `${city} Central Market`, description: 'Local goods, souvenirs, and produce under one roof.' },
    { name: `${city} Shopping District`, description: 'Boutiques and flagship stores along the main strip.' },
    { name: `Artisan Market in ${city}`, description: 'Handmade goods from local makers.' },
  ],
  cafe: (city) => [
    { name: `Cozy Café in ${city}`, description: 'A relaxed spot to recharge between stops.' },
    { name: `${city} Specialty Coffee House`, description: 'Locally roasted coffee worth the detour.' },
  ],
  activity: (city) => [
    { name: `${city} Rooftop Bar`, description: 'Evening drinks with a skyline view.' },
    { name: `Evening Cruise in ${city}`, description: 'See the city from the water as the sun sets.' },
    { name: `${city} Live Music Venue`, description: 'Local sounds and a lively late-night crowd.' },
  ],
}

export type PlaceSuggestion = { category: PlaceCategory; name: string; description: string }

// Same curated templates AI generation draws from — reused so manually added
// places read consistently with generated ones instead of needing a second
// content source.
export function suggestedPlacesForCity(city: string): PlaceSuggestion[] {
  return (Object.keys(CATEGORY_TEMPLATES) as PlaceCategory[]).flatMap((category) =>
    CATEGORY_TEMPLATES[category]!(city).map((template) => ({ category, ...template })),
  )
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trip'
}

function formatBudget(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'Flexible'
  if (trimmed.startsWith('$')) return trimmed
  return /^[\d,.]+$/.test(trimmed) ? `$${trimmed}` : trimmed
}

function resolveCategories(input: CreateTripInput): PlaceCategory[] {
  const mapped = input.preferences
    .map((preference) => PREFERENCE_CATEGORY[preference])
    .filter((category): category is PlaceCategory => Boolean(category))

  return mapped.length > 0 ? mapped : [TRAVEL_STYLE_CATEGORY[input.travelStyle] ?? 'culture']
}

export function generateTrip(input: CreateTripInput, existingTripIds: string[]): { trip: Trip; places: Place[] } {
  const city = input.destination.split(',')[0].trim() || input.destination
  const days = Math.max(1, Math.min(30, Math.round(input.duration) || 7))
  const tripId = `${slugify(input.destination)}-${nanoid(6)}`
  const palette = TRIP_PALETTE[existingTripIds.length % TRIP_PALETTE.length]
  const categories = resolveCategories(input)

  const places: Place[] = []
  const usedNames = new Set<string>()

  function addPlace(category: PlaceCategory, columnId: string): Place {
    const templates = CATEGORY_TEMPLATES[category] ?? CATEGORY_TEMPLATES.culture!
    const options = templates(city)
    const template = options.find((option) => !usedNames.has(option.name)) ?? options[places.length % options.length]
    usedNames.add(template.name)

    const place: Place = {
      id: nanoid(8),
      tripId,
      name: template.name,
      category,
      estimatedTime: [1.5, 2, 2.5][places.length % 3],
      estimatedCost: ['Free', '$', '$$'][places.length % 3],
      address: input.destination,
      // Real coordinates aren't looked up yet — the map still positions pins by index, not lat/lng.
      lat: 0,
      lng: 0,
      rating: ['4.5', '4.6', '4.7', '4.8'][places.length % 4],
      description: template.description,
      columnId,
      imageGradient: PLACE_GRADIENTS[places.length % PLACE_GRADIENTS.length],
    }
    places.push(place)
    return place
  }

  const columns: TripColumn[] = Array.from({ length: days }, (_, index) => {
    const dayNumber = index + 1
    const columnId = `day-${dayNumber}`
    const placeIds = [0, 1].map((i) => addPlace(categories[(index * 2 + i) % categories.length], columnId).id)

    return { id: columnId, title: `Day ${dayNumber}`, dayNumber, placeIds }
  })

  const trip: Trip = {
    id: tripId,
    title: `${city} Trip`,
    destination: input.destination,
    days,
    travelers: input.travelers,
    budget: formatBudget(input.budget),
    placeCount: places.length,
    color: palette.color,
    imageGradient: palette.imageGradient,
    dateRange: 'Dates TBD',
    preferences: input.preferences,
    pace: TRAVEL_STYLE_PACE[input.travelStyle] ?? 'balanced',
    columns,
  }

  return { trip, places }
}
