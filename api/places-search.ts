import {
  geocodeCityCenter,
  nearbyPlaces,
  searchPlaces,
  SEARCHABLE_CATEGORIES,
  type GeoPoint,
  type SearchableCategory,
} from './_lib/placesVerify.js'

// Chat-speed budget, not trip-generation's 30s — this is a human typing into
// a search box in AddPlaceModal.vue, not an AI call. Set with headroom above
// the worst case, not just the common case: geocodeCityCenter and
// searchPlaces/nearbyPlaces each carry their own independent ~8s timeout (see
// REQUEST_TIMEOUT_MS in _lib/placesVerify.ts) and run sequentially below, so a
// slow-but-successful (not erroring) round on both can approach ~16s.
export const config = { maxDuration: 20 }

type VercelLikeRequest = {
  method?: string
  body?: unknown
  on?: (event: 'close', listener: () => void) => void
}
type VercelLikeResponse = {
  status: (code: number) => VercelLikeResponse
  json: (body: unknown) => void
}

type PlacesSearchBody = {
  query?: string
  category?: string
  destination?: string
  // Set by the client once a prior response in the same search session
  // already resolved it (see AddPlaceModal.vue) — skips re-resolving the
  // trip's own (session-constant) city center on every keystroke search.
  cityCenter?: GeoPoint | null
  // Centroid of the day column the modal was opened from, computed
  // client-side in TripBoardPage.vue from that day's already-added places —
  // null when the day has none yet (or none are pinned). See searchPlaces'/
  // nearbyPlaces' own comments for why this takes priority over cityCenter.
  dayAnchor?: GeoPoint | null
}

function parseCategory(value: unknown): SearchableCategory | undefined {
  return typeof value === 'string' && (SEARCHABLE_CATEGORIES as readonly string[]).includes(value)
    ? (value as SearchableCategory)
    : undefined
}

function parseGeoPoint(value: unknown): GeoPoint | null | undefined {
  if (value === null) return null
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as GeoPoint).lat === 'number' &&
    typeof (value as GeoPoint).lng === 'number'
  ) {
    return value as GeoPoint
  }
  return undefined
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    res.status(404).json({ error: 'Places search not configured' })
    return
  }

  const { query, category, destination, cityCenter: bodyCityCenter, dayAnchor: bodyDayAnchor } = (req.body ?? {}) as PlacesSearchBody
  const trimmedQuery = typeof query === 'string' ? query.trim() : ''
  const parsedCategory = parseCategory(category)
  // A query alone, or a category chip alone (browse-nearby, no typed text —
  // see nearbyPlaces), is enough to search on. Neither present means
  // AddPlaceModal.vue's fully-unfiltered empty state, which has nothing to
  // search for at all.
  if (!trimmedQuery && !parsedCategory) {
    res.status(400).json({ error: 'Missing query or category' })
    return
  }
  if (typeof destination !== 'string' || !destination.trim()) {
    res.status(400).json({ error: 'Missing destination' })
    return
  }

  // If the client gives up (a newer keystroke superseded this request, the
  // modal closed), stop the in-flight Google calls instead of paying for a
  // response nobody will read.
  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  try {
    const providedCityCenter = parseGeoPoint(bodyCityCenter)
    const cityCenter =
      providedCityCenter !== undefined ? providedCityCenter : await geocodeCityCenter(apiKey, destination, controller.signal)
    const dayAnchor = parseGeoPoint(bodyDayAnchor) ?? null

    // No typed text but a category chip is active: browse-by-category via
    // Nearby Search (POPULARITY-ranked, no query needed) instead of Text
    // Search, which requires one. Every other case (there's a query, with or
    // without a category) goes through Text Search as before.
    let results
    if (!trimmedQuery && parsedCategory) {
      // nearbyPlaces itself handles a null cityCenter (falls back to
      // dayAnchor alone, or returns [] if neither is available) — no gate
      // needed here.
      results = await nearbyPlaces(apiKey, parsedCategory, dayAnchor, cityCenter, controller.signal)
    } else {
      results = await searchPlaces(apiKey, trimmedQuery, parsedCategory, dayAnchor, cityCenter, controller.signal)
    }
    // Echoed back so the client can cache it for the rest of this search
    // session instead of resending just `destination` and paying for another
    // geocode on every subsequent keystroke search (see cityCenter above).
    res.status(200).json({ results, cityCenter })
  } catch (error) {
    console.error('places-search failed', error)
    res.status(502).json({ error: 'Search failed' })
  }
}
