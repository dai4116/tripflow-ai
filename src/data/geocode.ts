export type GeoPoint = { lat: number; lng: number }

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

// Nominatim's usage policy caps unauthenticated use at ~1 request/second —
// this queue serializes lookups with a safety margin so an itinerary with
// many places doesn't burst past that and get the app rate-limited.
const MIN_INTERVAL_MS = 1100

const cache = new Map<string, GeoPoint | null>()
let queue: Promise<unknown> = Promise.resolve()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.then(
    () => delay(MIN_INTERVAL_MS),
    () => delay(MIN_INTERVAL_MS),
  )
  return run
}

async function geocodeQuery(query: string): Promise<GeoPoint | null> {
  const key = query.trim().toLowerCase()
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null

  const point = await enqueue(async () => {
    try {
      const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) return null

      const results = (await response.json()) as { lat: string; lon: string }[]
      const first = results[0]
      return first ? { lat: Number.parseFloat(first.lat), lng: Number.parseFloat(first.lon) } : null
    } catch {
      // Network hiccup or blocked request — the caller just doesn't get a
      // pin for this place, nothing to surface to the user over.
      return null
    }
  })

  cache.set(key, point)
  return point
}

export function geocodePlace(name: string, city: string): Promise<GeoPoint | null> {
  return geocodeQuery(city ? `${name}, ${city}` : name)
}

export function geocodeCity(city: string): Promise<GeoPoint | null> {
  return geocodeQuery(city)
}
