import { withTimeout } from './httpTimeout'

// Talks to /api/place-cover-photos — TripSettingsModal.vue's "變更封面照"
// picker. Same never-throws contract as placesSearchClient.ts's searchPlaces:
// any failure (no route in local `vite dev`, missing GOOGLE_PLACES_API_KEY,
// timeout, abort) resolves to undefined so the modal can show an error state
// instead of an unhandled rejection. Distinct from an empty array, which
// means "resolved fine, this destination just has no photos on record".
const REQUEST_TIMEOUT_MS = 8000

export async function fetchTripCoverPhotoRefs(placeId: string, signal?: AbortSignal): Promise<string[] | undefined> {
  const { signal: combinedSignal, clear } = withTimeout(REQUEST_TIMEOUT_MS, signal)

  try {
    const response = await fetch('/api/place-cover-photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId }),
      signal: combinedSignal,
    })
    if (!response.ok) return undefined

    const data = (await response.json()) as { photoRefs?: string[] }
    return Array.isArray(data.photoRefs) ? data.photoRefs : []
  } catch {
    return undefined
  } finally {
    clear()
  }
}
