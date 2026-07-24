// Google Places API (New) — Text Search verification.
//
// Confirms an AI-suggested place actually exists as a real POI and returns
// its authoritative coordinates + place_id, region-locked to the trip's
// destination. This replaces the old "AI name -> OpenStreetMap/Nominatim
// free-text lookup" path, whose failure modes were structural: Nominatim
// never returns "no match" (it always returns a best fuzzy guess, so a vague
// name like "中信市場美食" silently pinned in Taipei even with "台中" in the
// query), and its Taiwan small-business coverage is thin.
//
// Every function returns null on failure and never throws — a place that
// can't be verified is DROPPED by the caller, not pinned as a guess. That's
// the whole point: the user never sees an un-pinnable or wrong-city place.
//
// Billing: the field mask requests places.location (a Pro-tier field), so
// each call is a "Text Search Pro" SKU — 5,000 free requests/month, then
// $32/1000. The module-level cache below reuses results within a warm
// serverless instance to keep billable calls down.

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

// Per-request cap. A trip verifies dozens of candidates in parallel (see
// verifyPlace's caller in api/generate-trip.ts) — with no timeout here, a
// single slow/hung Google response blocked the whole Promise.all batch until
// Vercel's own 60s function limit killed the entire request (confirmed live:
// every call in that batch is wasted, not just the one that was actually
// stuck). Bounding each call individually means one bad request only costs
// that one place — it fails, gets caught below, and the rest proceed.
const REQUEST_TIMEOUT_MS = 8000

// locationBias radius (meters). Google caps this at 50km; 40km comfortably
// covers a city plus its nearby attractions without being so wide it stops
// disambiguating between cities.
const BIAS_RADIUS_M = 40000

// A verified hit further than this from the destination city center is
// rejected as a wrong-city fuzzy match (Taichung -> Taipei is ~130km, well
// past this). Generous enough to keep legit day-trip / suburban spots.
const MAX_KM_FROM_CITY = 80

export type GeoPoint = { lat: number; lng: number }
export type VerifiedPlace = { placeId: string; name: string; lat: number; lng: number }

// Keyed by lowercased query string. Stores `null` for a genuine no-match so
// the same dud query isn't re-billed; a network/non-2xx failure is NOT cached
// (see textSearchCached) so it can be retried on a later call.
const cache = new Map<string, VerifiedPlace | null>()

type TextSearchResponse = {
  places?: Array<{
    id?: string
    displayName?: { text?: string }
    location?: { latitude?: number; longitude?: number }
    businessStatus?: string
  }>
}

// One raw Text Search call. Throws on network / non-2xx so the caller can
// decide whether to cache (genuine empty) or not (transient failure).
async function textSearch(apiKey: string, textQuery: string, bias: GeoPoint | null): Promise<VerifiedPlace | null> {
  const body: Record<string, unknown> = {
    textQuery,
    // Prefer Traditional Chinese names where Google has them; falls back to
    // the local/official name otherwise. We keep the AI's display name for
    // the UI anyway and only take coordinates + place_id from here.
    languageCode: 'zh-TW',
    maxResultCount: 1,
  }
  if (bias) {
    body.locationBias = {
      circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: BIAS_RADIUS_M },
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Field mask is required by the Places API (New). location is what
        // makes this a Pro-tier call; id/displayName/businessStatus ride
        // along at no extra tier cost.
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.businessStatus',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new Error(`Places search failed: ${response.status}`)

  const data = (await response.json()) as TextSearchResponse
  const first = data.places?.[0]
  const lat = first?.location?.latitude
  const lng = first?.location?.longitude
  if (!first?.id || typeof lat !== 'number' || typeof lng !== 'number') return null
  // Google's own text-match existing doesn't mean it's still open — a stale
  // or not-yet-updated listing (confirmed live: the AI's "東山樂園" resolved
  // to a real place that's since rebranded/closed) would otherwise pass
  // straight through as a "verified, real" pin. CLOSED_TEMPORARILY is left
  // alone — a listing that's temporarily closed today may well be open again
  // by the trip's actual dates, which this app has no way to check.
  if (first.businessStatus === 'CLOSED_PERMANENTLY') return null
  return { placeId: first.id, name: first.displayName?.text ?? '', lat, lng }
}

async function textSearchCached(apiKey: string, query: string, bias: GeoPoint | null): Promise<VerifiedPlace | null> {
  const key = query.trim().toLowerCase()
  if (!key) return null

  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const result = await textSearch(apiKey, query, bias)
  cache.set(key, result)
  return result
}

// Haversine distance in km — the structural guard against a wrong-city hit
// slipping past the location bias. Exported: generate-trip.ts reuses this
// same math for its own same-day distance check (see its "day anchor"
// comment), rather than duplicating the formula.
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Geocode the trip's destination to a center point, used to bias (and
// sanity-check) every place lookup. One call per trip. Returns null if the
// destination itself can't be resolved — the caller then verifies without a
// bias, relying on the query's own city/country tokens.
export async function geocodeCityCenter(apiKey: string, destination: string): Promise<GeoPoint | null> {
  try {
    const result = await textSearchCached(apiKey, destination, null)
    return result ? { lat: result.lat, lng: result.lng } : null
  } catch {
    return null
  }
}

// Verify one place against Google, trying each query in turn (the AI's
// primary geocodeQuery, then its shorter geocodeQueryAlt). Rejects a hit that
// lands too far from the city center. Returns null if nothing verifies — the
// caller drops the place. Never throws.
export async function verifyPlace(
  apiKey: string,
  queries: string[],
  cityCenter: GeoPoint | null,
): Promise<VerifiedPlace | null> {
  for (const query of queries) {
    if (!query?.trim()) continue
    let result: VerifiedPlace | null
    try {
      result = await textSearchCached(apiKey, query, cityCenter)
    } catch {
      // Transient failure (network / rate limit) — not cached; try the next
      // query, and this place stays eligible on a later generation attempt.
      continue
    }
    if (!result) continue
    if (cityCenter && distanceKm(cityCenter, { lat: result.lat, lng: result.lng }) > MAX_KM_FROM_CITY) continue
    return result
  }
  return null
}
