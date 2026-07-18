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

// Distinct per-day colors for the trip map (pins + route line) — reused
// from colors already used elsewhere in the app (TRIP_PALETTE, the accent
// tones in PLACE_GRADIENTS) rather than inventing a new set, so the map
// stays visually consistent with the rest of the UI instead of introducing
// its own palette. Cycles for trips longer than 6 days.
export const DAY_COLORS = ['#00c5ab', '#4a7de0', '#d98324', '#8161e6', '#4d9166', '#e8618c']

export function dayColorForIndex(index: number): string {
  return DAY_COLORS[index % DAY_COLORS.length]!
}

const PREFERENCE_CATEGORY: Record<string, PlaceCategory> = {
  博物館: 'culture',
  海灘: 'nature',
  健行: 'nature',
  在地美食: 'food',
  夜生活: 'activity',
  購物: 'shopping',
  藝廊: 'culture',
  建築: 'culture',
  街頭小吃: 'food',
  廟宇: 'culture',
  公園: 'nature',
  市集: 'shopping',
  咖啡廳: 'cafe',
  觀景點: 'nature',
}

const TRAVEL_STYLE_CATEGORY: Record<string, PlaceCategory> = {
  冒險: 'activity',
  放鬆: 'nature',
  文化: 'culture',
  美食: 'food',
  攝影: 'culture',
  自然: 'nature',
}

const TRAVEL_STYLE_PACE: Record<string, TripPace> = {
  放鬆: 'relaxed',
  冒險: 'packed',
}

type CategoryTemplate = { name: string; description: string }

const CATEGORY_TEMPLATES: Partial<Record<PlaceCategory, (city: string) => CategoryTemplate[]>> = {
  culture: (city) => [
    { name: `${city}舊城區散步`, description: `漫遊${city}的歷史街道與地標建築。` },
    { name: `${city}歷史博物館`, description: `深入了解${city}的故事與文化。` },
    { name: `${city}地標大教堂`, description: `${city}最多人拍照打卡的建築地標之一。` },
  ],
  food: (city) => [
    { name: `${city}夜市`, description: `${city}入夜後的路邊攤與在地美食。` },
    { name: `${city}在地人氣餐廳`, description: '當地人真心推薦、常去吃的店。' },
    { name: `${city}街頭小吃巷弄`, description: '一條街吃遍在地小吃與特色風味。' },
  ],
  nature: (city) => [
    { name: `${city}景觀台`, description: `俯瞰${city}全景，日落時分最美。` },
    { name: `${city}植物園`, description: `${city}市中心的靜謐綠洲。` },
    { name: `${city}近郊海岸步道`, description: '城市外圍的新鮮空氣與遼闊海景。' },
  ],
  shopping: (city) => [
    { name: `${city}中央市場`, description: '在地特產、紀念品與新鮮食材一次逛齊。' },
    { name: `${city}購物商圈`, description: '精品小店與品牌旗艦店林立的主要街道。' },
    { name: `${city}手作市集`, description: '在地職人手作的獨特商品。' },
  ],
  cafe: (city) => [
    { name: `${city}溫馨咖啡廳`, description: '行程中場休息、放鬆充電的好地方。' },
    { name: `${city}精品咖啡館`, description: '值得繞路造訪的在地烘焙咖啡。' },
  ],
  activity: (city) => [
    { name: `${city}屋頂酒吧`, description: '邊喝一杯邊欣賞城市天際線。' },
    { name: `${city}夜間遊船`, description: '在日落時分從水上欣賞城市風景。' },
    { name: `${city}現場音樂展演空間`, description: '在地樂手演出與熱鬧的深夜氛圍。' },
  ],
}

export type PlaceSuggestion = { category: PlaceCategory; name: string; description: string; travelTip?: string }

// Same curated templates AI generation draws from — reused so manually added
// places read consistently with generated ones instead of needing a second
// content source.
export function suggestedPlacesForCity(city: string): PlaceSuggestion[] {
  return (Object.keys(CATEGORY_TEMPLATES) as PlaceCategory[]).flatMap((category) =>
    CATEGORY_TEMPLATES[category]!(city).map((template) => ({ category, ...template })),
  )
}

// Trip/template destinations are free text like "京都，日本" — the part
// before the comma is what geocoding and city-flavored copy actually want.
export function cityFromDestination(destination: string): string {
  return destination.split(/[,，]/)[0].trim() || destination
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

// Exported so callers can size an AI place request (days * 2) before the
// deterministic trip scaffolding runs, without duplicating the clamp logic.
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

function resolveCategories(input: CreateTripInput): PlaceCategory[] {
  const mapped = input.preferences
    .map((preference) => PREFERENCE_CATEGORY[preference])
    .filter((category): category is PlaceCategory => Boolean(category))

  return mapped.length > 0 ? mapped : [TRAVEL_STYLE_CATEGORY[input.travelStyle] ?? 'culture']
}

// aiPlaces (when provided by the /api/generate-trip endpoint) supplies the
// name/category/description/travelTip for each place, in visit order — all
// other bookkeeping (ids, palette, gradients, estimatedTime/cost, rating,
// lat/lng) stays local rather than trusting the model for facts it can't
// actually know. Falls back to the local CATEGORY_TEMPLATES picker per-slot
// whenever aiPlaces is absent or runs short.
export function generateTrip(
  input: CreateTripInput,
  existingTripIds: string[],
  aiPlaces?: PlaceSuggestion[],
): { trip: Trip; places: Place[] } {
  const city = cityFromDestination(input.destination)
  const days = computeTripDays(input)
  const tripId = `${slugify(input.destination)}-${nanoid(6)}`
  const palette = TRIP_PALETTE[existingTripIds.length % TRIP_PALETTE.length]
  const categories = resolveCategories(input)

  const places: Place[] = []
  const usedNames = new Set<string>()

  function addPlace(category: PlaceCategory, columnId: string, suggestion?: PlaceSuggestion): Place {
    let template: CategoryTemplate
    if (suggestion) {
      template = suggestion
    } else {
      const templates = CATEGORY_TEMPLATES[category] ?? CATEGORY_TEMPLATES.culture!
      const options = templates(city)
      template = options.find((option) => !usedNames.has(option.name)) ?? options[places.length % options.length]
    }
    usedNames.add(template.name)

    const place: Place = {
      id: nanoid(8),
      tripId,
      name: template.name,
      category,
      estimatedTime: 1,
      address: input.destination,
      // Real coordinates aren't looked up yet — the map still positions pins by index, not lat/lng.
      lat: 0,
      lng: 0,
      rating: ['4.5', '4.6', '4.7', '4.8'][places.length % 4],
      description: template.description,
      travelTip: suggestion?.travelTip,
      columnId,
      imageGradient: PLACE_GRADIENTS[places.length % PLACE_GRADIENTS.length],
    }
    places.push(place)
    return place
  }

  const columns: TripColumn[] = Array.from({ length: days }, (_, index) => {
    const dayNumber = index + 1
    const columnId = `day-${dayNumber}`
    const placeIds = [0, 1].map((i) => {
      const flatIndex = index * 2 + i
      const suggestion = aiPlaces?.[flatIndex]
      const category = suggestion?.category ?? categories[flatIndex % categories.length]
      return addPlace(category, columnId, suggestion).id
    })

    return { id: columnId, title: `第${dayNumber}天`, dayNumber, placeIds }
  })

  const trip: Trip = {
    id: tripId,
    title: `${city}之旅`,
    destination: input.destination,
    days,
    travelers: input.travelers,
    placeCount: places.length,
    color: palette.color,
    imageGradient: palette.imageGradient,
    dateRange: formatDateRange(input.startDate, input.endDate),
    startDate: input.startDate,
    preferences: input.preferences,
    pace: TRAVEL_STYLE_PACE[input.travelStyle] ?? 'balanced',
    columns,
  }

  return { trip, places }
}
