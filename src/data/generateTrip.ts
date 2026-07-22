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

const TRAVEL_STYLE_PACE: Record<string, TripPace> = {
  放鬆: 'relaxed',
  冒險: 'packed',
}

export function paceForTravelStyle(travelStyle: string): TripPace {
  return TRAVEL_STYLE_PACE[travelStyle] ?? 'balanced'
}

// How many places make up one day's column, by pace — a relaxed trip leaves
// more breathing room, a packed one fits more in. Each day is meant to
// include two food-category slots (lunch + dinner — see lunchSlotIndex/
// dinnerSlotIndex in the columns loop below), so even the lightest pace
// still reads as a full day rather than two bare activities. That's only a
// hard guarantee for the local CATEGORY_TEMPLATES fallback path, though —
// when an AI suggestion exists for a slot, its own category is trusted as-is
// (see the columns loop), so the two-meals structure for AI-generated trips
// depends on the model actually following the matching instruction in
// api/generate-trip.ts's prompt, not on anything enforced here.
const PLACES_PER_DAY: Record<TripPace, number> = {
  relaxed: 3,
  balanced: 4,
  packed: 5,
}

export function placesPerDayForPace(pace: TripPace): number {
  return PLACES_PER_DAY[pace]
}

// nightOnly marks food templates whose own description ties them to evening/
// after-dark (a night market, a late-night bar-restaurant) — excluded when
// picking a local-fallback place for a lunch slot specifically, so the
// picker can't hand back a place whose blurb contradicts the midday arrival
// time next to it. Meaningless outside the food array; harmless elsewhere.
type CategoryTemplate = { name: string; description: string; nightOnly?: boolean }

// One category (food) is drawn from twice per day, every day, regardless of
// pace (see the lunch/dinner slots in generateTrip's columns loop below) —
// sized with more entries than the others so a multi-day trip doesn't repeat
// the same canned name for both meals, or across consecutive days, as often.
const CATEGORY_TEMPLATES: Partial<Record<PlaceCategory, (city: string) => CategoryTemplate[]>> = {
  culture: (city) => [
    { name: `${city}舊城區散步`, description: `漫遊${city}的歷史街道與地標建築。` },
    { name: `${city}歷史博物館`, description: `深入了解${city}的故事與文化。` },
    { name: `${city}地標大教堂`, description: `${city}最多人拍照打卡的建築地標之一。` },
    { name: `${city}老城牆遺跡`, description: `走一段見證${city}歷史的城牆步道。` },
    { name: `${city}藝術美術館`, description: '欣賞當代與經典藝術作品的好去處。' },
    { name: `${city}傳統工藝街`, description: `體驗${city}代代相傳的手工技藝。` },
    { name: `${city}古蹟廟宇`, description: `${city}信仰文化的重要據點。` },
    { name: `${city}文化園區`, description: '結合展覽與表演的複合式文化空間。' },
  ],
  food: (city) => [
    { name: `${city}夜市`, description: `${city}入夜後的路邊攤與在地美食。`, nightOnly: true },
    { name: `${city}在地人氣餐廳`, description: '當地人真心推薦、常去吃的店。' },
    { name: `${city}街頭小吃巷弄`, description: '一條街吃遍在地小吃與特色風味。' },
    { name: `${city}傳統市場美食`, description: '在市場裡尋寶般找到道地古早味。' },
    { name: `${city}排隊名店`, description: '在地人跟遊客都願意排隊等的一道好菜。' },
    { name: `${city}老字號小館`, description: '傳承好幾代的家常好味道。' },
    { name: `${city}海鮮餐廳`, description: '新鮮直送、澎湃上桌的海味料理。' },
    { name: `${city}在地小吃攤`, description: '銅板價就能吃到的在地滋味。' },
    { name: `${city}特色餐酒館`, description: '佐餐美酒與創意料理的悠閒夜晚。', nightOnly: true },
    { name: `${city}巷弄裡的隱藏美食`, description: '只有在地人才知道的低調好店。' },
  ],
  nature: (city) => [
    { name: `${city}景觀台`, description: `俯瞰${city}全景，日落時分最美。` },
    { name: `${city}植物園`, description: `${city}市中心的靜謐綠洲。` },
    { name: `${city}近郊海岸步道`, description: '城市外圍的新鮮空氣與遼闊海景。' },
    { name: `${city}城市公園`, description: '城市裡最容易親近的一片綠意。' },
    { name: `${city}登山步道`, description: `健行順便欣賞${city}的城市天際線。` },
    { name: `${city}湖畔步道`, description: '沿著湖岸悠閒散步的好去處。' },
    { name: `${city}日出觀景點`, description: `早起換來${city}最美的第一道光。` },
    { name: `${city}生態保護區`, description: '近距離認識當地的自然生態。' },
  ],
  shopping: (city) => [
    { name: `${city}中央市場`, description: '在地特產、紀念品與新鮮食材一次逛齊。' },
    { name: `${city}購物商圈`, description: '精品小店與品牌旗艦店林立的主要街道。' },
    { name: `${city}手作市集`, description: '在地職人手作的獨特商品。' },
    { name: `${city}百貨商場`, description: '一站買齊各種品牌與伴手禮。' },
    { name: `${city}文青選品店`, description: '挑選有故事的獨立設計小物。' },
    { name: `${city}二手古著市集`, description: '尋寶挖到獨一無二的老件。' },
    { name: `${city}地下街商場`, description: '遮風避雨也能逛一整天。' },
    { name: `${city}紀念品專賣店`, description: `把${city}的回憶帶回家。` },
  ],
  cafe: (city) => [
    { name: `${city}溫馨咖啡廳`, description: '行程中場休息、放鬆充電的好地方。' },
    { name: `${city}精品咖啡館`, description: '值得繞路造訪的在地烘焙咖啡。' },
    { name: `${city}老宅咖啡廳`, description: '在有故事的老建築裡喝一杯咖啡。' },
    { name: `${city}景觀咖啡廳`, description: `邊喝咖啡邊欣賞${city}的城市風景。` },
    { name: `${city}甜點咖啡館`, description: '手作甜點配咖啡的療癒午後。' },
    { name: `${city}書香咖啡廳`, description: '在書堆與咖啡香裡放慢腳步。' },
  ],
  activity: (city) => [
    { name: `${city}屋頂酒吧`, description: '邊喝一杯邊欣賞城市天際線。' },
    { name: `${city}夜間遊船`, description: '在日落時分從水上欣賞城市風景。' },
    { name: `${city}現場音樂展演空間`, description: '在地樂手演出與熱鬧的深夜氛圍。' },
    { name: `${city}夜景觀景台`, description: `俯瞰${city}華燈初上的璀璨夜色。` },
    { name: `${city}體驗工作坊`, description: `親手做一份屬於${city}的紀念品。` },
    { name: `${city}主題樂園`, description: '全家大小都能玩得盡興。' },
    { name: `${city}在地文化體驗`, description: `換上傳統服飾感受${city}的日常。` },
    { name: `${city}深夜酒吧`, description: `${city}夜生活的道地去處。` },
  ],
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
  // Which trip day (1-indexed) this suggestion belongs to, set by the AI and
  // preserved through server-side verification (see api/generate-trip.ts).
  // generateTrip() groups by this field rather than by array position —
  // position-based day-chunking broke once verification could drop an
  // arbitrary subset of candidates: a shortfall early in the flat array
  // shifted every later position, and once the array ran out, every
  // remaining day silently came up empty. Absent for locally-templated
  // suggestions (AddPlaceModal), which don't belong to a generated trip.
  day?: number
}

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

// aiPlaces (from the /api/generate-trip endpoint) supplies the
// name/category/description/travelTip for each place, in visit order, and —
// when verified server-side against Google Places — its coordinates too. All
// other bookkeeping (ids, palette, gradients, estimatedTime/cost, rating)
// stays local rather than trusting the model for facts it can't actually
// know. Days are built purely from aiPlaces; a slot with no suggestion is
// left empty rather than backfilled (see the columns loop).
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
  const pace = paceForTravelStyle(input.travelStyle)
  const resolvedPlacesPerDay = placesPerDay ?? placesPerDayForPace(pace)
  const tripId = `${slugify(input.destination)}-${nanoid(6)}`
  const palette = TRIP_PALETTE[existingTripIds.length % TRIP_PALETTE.length]

  const places: Place[] = []
  const usedNames = new Set<string>()

  function addPlace(category: PlaceCategory, columnId: string, suggestion?: PlaceSuggestion, mealHint?: 'lunch' | 'dinner'): Place {
    let template: CategoryTemplate
    if (suggestion) {
      template = suggestion
    } else {
      const templates = CATEGORY_TEMPLATES[category] ?? CATEGORY_TEMPLATES.culture!
      const allOptions = templates(city)
      // For a lunch slot specifically, skip nightOnly entries (a night
      // market etc.) so the local fallback can't hand back a place whose own
      // description contradicts a midday arrival time — dinner has no such
      // restriction. Falls back to the unfiltered list if that leaves
      // nothing (e.g. a category with no nightOnly-tagged entries at all).
      const options = mealHint === 'lunch' ? allOptions.filter((option) => !option.nightOnly) : allOptions
      const pool = options.length > 0 ? options : allOptions
      template = pool.find((option) => !usedNames.has(option.name)) ?? pool[places.length % pool.length]
    }
    usedNames.add(template.name)

    const place: Place = {
      id: nanoid(8),
      tripId,
      name: template.name,
      category,
      estimatedTime: 1,
      address: input.destination,
      // Coordinates come from the suggestion when it was verified server-side
      // against Google Places (the normal path — the place is pinned on the
      // map immediately). They're 0,0 only on the no-Google-key interim path,
      // where the trips store still geocodes via Nominatim in the background
      // (see geocodeNewPlaces in stores/trips.ts).
      lat: suggestion?.lat ?? 0,
      lng: suggestion?.lng ?? 0,
      rating: ['4.5', '4.6', '4.7', '4.8'][places.length % 4],
      description: template.description,
      travelTip: suggestion?.travelTip,
      geocodeQuery: suggestion?.geocodeQuery,
      geocodeQueryAlt: suggestion?.geocodeQueryAlt,
      columnId,
      imageGradient: PLACE_GRADIENTS[places.length % PLACE_GRADIENTS.length],
    }
    places.push(place)
    return place
  }

  // Lunch and dinner anchor each day: lunch sits roughly mid-day, dinner is
  // always the last slot, with other categories filling the rest — same
  // math for every pace (3/4/5 per day), e.g. 4 gives [activity, lunch,
  // activity, dinner]. Only applies when there's no AI suggestion for that
  // slot already carrying its own category (the AI prompt asks for the same
  // lunch/dinner structure itself).
  const lunchSlotIndex = Math.floor((resolvedPlacesPerDay - 1) / 2)
  const dinnerSlotIndex = resolvedPlacesPerDay - 1

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
    const dayPlaces = suggestionsByDay.get(dayNumber) ?? []
    const placeIds: string[] = []
    for (let i = 0; i < resolvedPlacesPerDay; i++) {
      const suggestion = dayPlaces[i]
      // Days are built ONLY from real (AI + server-verified) suggestions now.
      // A slot with no suggestion is left empty rather than backfilled from a
      // local CATEGORY_TEMPLATES place — since createTrip verifies every place
      // against Google Places and drops any it can't find, backfilling would
      // silently reintroduce a generic/un-pinnable place, exactly what
      // verification exists to prevent. A short day just has fewer, all-real
      // places. (addPlace still supports template fallback for any future
      // caller, but generation no longer uses it.)
      if (!suggestion) continue
      const mealHint = i === lunchSlotIndex ? 'lunch' : i === dinnerSlotIndex ? 'dinner' : undefined
      placeIds.push(addPlace(suggestion.category, columnId, suggestion, mealHint).id)
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
    color: palette.color,
    imageGradient: palette.imageGradient,
    dateRange: formatDateRange(input.startDate, input.endDate),
    startDate: input.startDate,
    preferences: input.preferences,
    pace,
    columns,
  }

  return { trip, places }
}
