import { withTimeout } from './httpTimeout'

// Talks to /api/places-search — AddPlaceModal.vue's live search-as-you-type,
// backed by a real (multi-result) Google Places Text Search rather than the
// old static suggestedPlacesForCity list. Same never-throws contract as
// askAiClient.ts's fetchAskAiResult: any failure (no route in local `vite
// dev`, missing GOOGLE_PLACES_API_KEY, timeout, abort) resolves to undefined
// so the modal can show an empty/error state instead of an unhandled
// rejection. Distinct from an empty array, which means "searched, no matches".
const REQUEST_TIMEOUT_MS = 8000

export type GeoPoint = { lat: number; lng: number }

// Duplicated from api/_lib/placesVerify.ts's identical shape rather than
// imported — api/ and src/ are independent deployable units (same reasoning
// as the PLACE_CATEGORIES/mapWithConcurrency copies already split that way
// elsewhere in this codebase).
export type PlaceSearchResult = {
  placeId: string
  name: string
  lat: number
  lng: number
  photoRef?: string
  category?: string
}

export type PlacesSearchResponse = {
  results: PlaceSearchResult[]
  // The resolved (or null, if geocoding failed) city center for `destination`
  // — cache this and pass it back on the next call in the same search session
  // (see AddPlaceModal.vue) so the server doesn't re-geocode an unchanging
  // destination on every keystroke search.
  cityCenter: GeoPoint | null
}

// signal lets the caller cancel a stale in-flight search when a newer
// keystroke supersedes it (see the debounce in AddPlaceModal.vue) — merged
// with this function's own timeout so either one aborts the request.
export async function searchPlaces(
  query: string,
  category: string | undefined,
  destination: string,
  // Centroid of the day column the modal was opened from — see
  // TripBoardPage.vue's computed of the same name and api/places-search.ts's
  // handling of it. null when that day has no places with real coordinates
  // yet, not just "not computed" (unlike cityCenter, this is never cached/
  // resolved server-side — the caller always knows it upfront). Ordered
  // before cityCenter to match api/_lib/placesVerify.ts's searchPlaces/
  // nearbyPlaces parameter order — the two "same-named, same-purpose"
  // functions previously disagreed, an easy trap for a future edit since
  // both parameters share the identical GeoPoint | null type.
  dayAnchor: GeoPoint | null,
  cityCenter: GeoPoint | null | undefined,
  signal?: AbortSignal,
): Promise<PlacesSearchResponse | undefined> {
  const { signal: combinedSignal, clear } = withTimeout(REQUEST_TIMEOUT_MS, signal)

  try {
    const response = await fetch('/api/places-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, category, destination, cityCenter, dayAnchor }),
      signal: combinedSignal,
    })
    if (!response.ok) return undefined

    const data = (await response.json()) as { results?: PlaceSearchResult[]; cityCenter?: GeoPoint | null }
    return {
      results: Array.isArray(data.results) ? data.results : [],
      cityCenter: data.cityCenter ?? null,
    }
  } catch {
    return undefined
  } finally {
    clear()
  }
}
