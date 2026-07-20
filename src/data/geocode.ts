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

async function fetchGeocode(query: string): Promise<GeoPoint | null> {
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Nominatim request failed: ${response.status}`)

  const results = (await response.json()) as { lat: string; lon: string }[]
  const first = results[0]
  return first ? { lat: Number.parseFloat(first.lat), lng: Number.parseFloat(first.lon) } : null
}

// Exported as-is (no city/region composition) for callers that already have
// a complete, self-contained query string — notably an AI-supplied
// geocodeQuery, which asks the model to include place + city + country
// itself, all in one consistent language. Composing it further here (e.g.
// appending a Chinese city extracted from the user's typed destination) can
// silently break an otherwise-correct query: Nominatim's free-text matching
// is comma-hierarchical and doesn't reconcile a local-language place name
// against city/country tokens in a different script — "Galleria degli
// Uffizi, Firenze, Italia" matches, but "Galleria degli Uffizi, 佛羅倫斯,
// 義大利" (same place, city/country appended in Chinese) returns nothing.
export async function geocodeRawQuery(query: string): Promise<GeoPoint | null> {
  const key = query.trim().toLowerCase()
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null

  try {
    const point = await enqueue(() => fetchGeocode(query))
    // Only a successful round trip (found, or genuinely no results) is
    // cached — a network hiccup or non-2xx response isn't remembered, so the
    // same place can be retried on a later geocode call instead of being
    // permanently pin-less for the rest of the session.
    cache.set(key, point)
    return point
  } catch {
    return null
  }
}

// `region` (e.g. the country/state part of a destination like "京都，日本")
// is appended as extra disambiguating context — without it, a bare place +
// city query can match a same-named place in the wrong country entirely.
// Only safe when `name` is already in the same language as city/region (see
// geocodeRawQuery above for why an AI geocodeQuery must bypass this).
function withRegion(query: string, region: string): string {
  return region ? `${query}, ${region}` : query
}

export function geocodePlace(name: string, city: string, region = ''): Promise<GeoPoint | null> {
  return geocodeRawQuery(withRegion(city ? `${name}, ${city}` : name, region))
}

export function geocodeCity(city: string, region = ''): Promise<GeoPoint | null> {
  return geocodeRawQuery(withRegion(city, region))
}
