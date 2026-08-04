import { withTimeout } from './httpTimeout'

// Talks to /api/places-autocomplete and /api/place-details — the destination
// search dropdown on trip creation (see DestinationAutocomplete.vue). Same
// never-throws contract as placesSearchClient.ts's searchPlaces: any failure
// (no route in local `vite dev`, missing GOOGLE_PLACES_API_KEY, timeout,
// abort) resolves to undefined rather than throwing, so the component can
// silently fall back to behaving like a plain text field — picking a
// suggestion is an optional data-quality upgrade, never required to submit
// the trip-creation form.
const REQUEST_TIMEOUT_MS = 8000

// Duplicated from api/_lib/placesVerify.ts's identical shapes rather than
// imported — api/ and src/ are independent deployable units (same reasoning
// as PlaceSearchResult's own duplication in placesSearchClient.ts).
export type DestinationSuggestion = { placeId: string; mainText: string; secondaryText: string }
export type ResolvedDestination = { lat: number; lng: number }

export async function autocompleteDestination(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<DestinationSuggestion[] | undefined> {
  const { signal: combinedSignal, clear } = withTimeout(REQUEST_TIMEOUT_MS, signal)
  try {
    const response = await fetch('/api/places-autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, sessionToken }),
      signal: combinedSignal,
    })
    if (!response.ok) return undefined

    const data = (await response.json()) as { suggestions?: DestinationSuggestion[] }
    return Array.isArray(data.suggestions) ? data.suggestions : []
  } catch {
    return undefined
  } finally {
    clear()
  }
}

export async function resolveDestinationPlace(
  placeId: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<ResolvedDestination | undefined> {
  const { signal: combinedSignal, clear } = withTimeout(REQUEST_TIMEOUT_MS, signal)
  try {
    const response = await fetch('/api/place-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId, sessionToken }),
      signal: combinedSignal,
    })
    if (!response.ok) return undefined

    const data = (await response.json()) as { lat?: number; lng?: number }
    if (typeof data.lat !== 'number' || typeof data.lng !== 'number') return undefined
    return { lat: data.lat, lng: data.lng }
  } catch {
    return undefined
  } finally {
    clear()
  }
}
