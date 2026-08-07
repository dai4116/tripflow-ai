import { resolveDestinationPlace } from './_lib/placesVerify.js'

export const config = { maxDuration: 10 }

type VercelLikeRequest = {
  method?: string
  body?: unknown
  on?: (event: 'close', listener: () => void) => void
}
type VercelLikeResponse = {
  status: (code: number) => VercelLikeResponse
  json: (body: unknown) => void
}

type GeocodeDestinationBody = { destination?: string }

// Best-effort fallback for stores/trips.ts's createTrip: resolves a
// free-typed trip destination (no Google Places Autocomplete pick) to a real
// place, so the trip still ends up with a destinationPlaceId — otherwise the
// cover-photo picker (TripSettingsModal.vue) has nothing to fetch candidates
// for. A single 404 covers both "no match" and "lookup failed" (see
// resolveDestinationPlace's own comment on why those collapse together
// here) — trip creation proceeds without a destinationPlaceId either way,
// this is never the thing that fails the request.
export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    res.status(404).json({ error: 'Geocoding not configured' })
    return
  }

  const { destination } = (req.body ?? {}) as GeocodeDestinationBody
  if (typeof destination !== 'string' || !destination.trim()) {
    res.status(400).json({ error: 'Missing destination' })
    return
  }

  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  const place = await resolveDestinationPlace(apiKey, destination, controller.signal)
  if (!place) {
    res.status(404).json({ error: 'Destination not found' })
    return
  }
  res.status(200).json({ placeId: place.placeId, lat: place.lat, lng: place.lng })
}
