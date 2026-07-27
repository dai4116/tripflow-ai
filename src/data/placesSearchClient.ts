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
  cityCenter: GeoPoint | null | undefined,
  signal?: AbortSignal,
): Promise<PlacesSearchResponse | undefined> {
  const timeoutController = new AbortController()
  const timer = window.setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal

  try {
    const response = await fetch('/api/places-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, category, destination, cityCenter }),
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
    window.clearTimeout(timer)
  }
}
