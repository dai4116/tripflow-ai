import { withTimeout } from './httpTimeout.ts'

// Best-effort fallback used only when trip creation didn't already get a
// destinationPlaceId from the user picking a Google Places Autocomplete
// suggestion (DestinationAutocomplete.vue) — resolves whatever free text
// they typed into a real Google place, so the cover-photo picker
// (TripSettingsModal.vue) still has a placeId to fetch candidates for.
// Same never-throws contract as placesSearchClient.ts's searchPlaces: any
// failure (no route in local `vite dev`, missing GOOGLE_PLACES_API_KEY,
// timeout, no match) resolves to undefined — trip creation must never be
// blocked or failed by this being unavailable.
const REQUEST_TIMEOUT_MS = 8000

export type ResolvedDestination = { placeId: string; lat: number; lng: number }

export async function geocodeDestination(destination: string, signal?: AbortSignal): Promise<ResolvedDestination | undefined> {
  const { signal: combinedSignal, clear } = withTimeout(REQUEST_TIMEOUT_MS, signal)

  try {
    const response = await fetch('/api/geocode-destination', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination }),
      signal: combinedSignal,
    })
    if (!response.ok) return undefined

    const data = (await response.json()) as { placeId?: string; lat?: number; lng?: number }
    if (!data.placeId || typeof data.lat !== 'number' || typeof data.lng !== 'number') return undefined
    return { placeId: data.placeId, lat: data.lat, lng: data.lng }
  } catch {
    return undefined
  } finally {
    clear()
  }
}
