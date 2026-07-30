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
// $32/1000. Callers that also want a cover photo (verifyPlace) opt into
// places.photos, which bumps THAT call to the pricier Enterprise tier — see
// includePhotos below. geocodeCityCenter never sets it, since it only reads
// lat/lng and would otherwise pay Enterprise pricing for a photo it discards.
// The module-level cache below reuses results within a warm serverless
// instance to keep billable calls down.

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

// Per-request cap. A trip verifies dozens of candidates in parallel (see
// verifyPlace's caller in api/generate-trip-day.ts) — with no timeout here, a
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

// Used instead of BIAS_RADIUS_M when searchPlaces/nearbyPlaces are anchored
// to a specific day's already-added stops (see dayAnchor on both) rather than
// the whole destination city — the point of anchoring to "what today already
// looks like" is a same-day-convenient result, which a 40km net (basically
// still city-wide) would defeat. 8km comfortably covers same-day walking-plus-
// short-hop range without narrowing so far it starves a day anchored in a
// sparser part of the city.
const DAY_ANCHOR_RADIUS_M = 8000

// Shared by searchPlaces and nearbyPlaces: prefers dayAnchor (with its
// tighter radius) over cityCenter, falling back to cityCenter (city-wide
// radius) when there's no day anchor yet, and to no anchor at all when
// neither is available. Kept as one function so a future change to this
// fallback policy (a third tier, a different precedence) only needs editing
// once instead of staying in sync by hand across both call sites.
function resolveAnchor(dayAnchor: GeoPoint | null, cityCenter: GeoPoint | null): { point: GeoPoint | null; radius: number } {
  const point = dayAnchor ?? cityCenter
  const radius = dayAnchor ? DAY_ANCHOR_RADIUS_M : BIAS_RADIUS_M
  return { point, radius }
}

// A verified hit further than this from the destination city center is
// rejected as a wrong-city fuzzy match (Taichung -> Taipei is ~130km, well
// past this). Generous enough to keep legit day-trip / suburban spots.
const MAX_KM_FROM_CITY = 80

export type GeoPoint = { lat: number; lng: number }
export type VerifiedPlace = { placeId: string; name: string; lat: number; lng: number; photoRef?: string }

// Keyed by `${includePhotos}:${lowercased query}`. The includePhotos flag is
// part of the key (not just the query) because the two callers below share
// this cache but request different field masks — without it, whichever call
// happens to run first for a given query would silently decide whether the
// other one ever sees a photoRef, e.g. geocodeCityCenter caching a
// photo-less result that verifyPlace then reuses for an identical query text.
// Stores `null` for a genuine no-match so the same dud query isn't re-billed;
// a network/non-2xx failure is NOT cached (see textSearchCached) so it can be
// retried on a later call.
const cache = new Map<string, VerifiedPlace | null>()

type TextSearchResponse = {
  places?: Array<{
    id?: string
    displayName?: { text?: string }
    location?: { latitude?: number; longitude?: number }
    businessStatus?: string
    types?: string[]
    photos?: Array<{ name?: string }>
  }>
}

// Google's own record for a place can outlive the place itself — a name
// that used to be a leisure/attraction spot gets repurposed (confirmed live:
// the AI's "東山樂園" resolved to a real, OPERATIONAL Google place that's now
// a bus interchange) and businessStatus alone can't catch this, since the
// location is genuinely still operating, just as something else entirely.
// These are google.com/maps "types" that are never what a trip itinerary
// should be pointing at, regardless of what category the AI thought it was
// suggesting — a transit hub or parking lot slipping past verification as a
// "real, verified" pin is wrong in every case, not just some.
const DISQUALIFYING_TYPES = new Set([
  'transit_station',
  'bus_station',
  'train_station',
  'subway_station',
  'light_rail_station',
  'airport',
  'parking',
  'gas_station',
])

// Extracts + validates one raw Google Places hit against the checks every
// caller needs regardless of whether it wants exactly one result (textSearch)
// or many (searchPlaces): real coordinates, not permanently closed, and not
// one of DISQUALIFYING_TYPES (see its own comment). `fallbackName` covers a
// missing/blank displayName — textSearch passes '' (its callers already fall
// back further, to the AI's original name — see generate-trip-day.ts's
// `verifiedName`), searchPlaces passes the user's own search text, since a
// human-typed query has nothing else to fall back to.
type RawPlace = NonNullable<TextSearchResponse['places']>[number]
type ParsedHit = { placeId: string; name: string; lat: number; lng: number; types: string[]; photoRef?: string }

function parseHit(raw: RawPlace, fallbackName: string): ParsedHit | null {
  const lat = raw.location?.latitude
  const lng = raw.location?.longitude
  if (!raw.id || typeof lat !== 'number' || typeof lng !== 'number') return null
  // Google's own text-match existing doesn't mean it's still open — a stale
  // or not-yet-updated listing (confirmed live: the AI's "東山樂園" resolved
  // to a real place that's since rebranded/closed) would otherwise pass
  // straight through as a "verified, real" pin. CLOSED_TEMPORARILY is left
  // alone — a listing that's temporarily closed today may well be open again
  // by the trip's actual dates, which this app has no way to check.
  if (raw.businessStatus === 'CLOSED_PERMANENTLY') return null
  const types = raw.types ?? []
  // See DISQUALIFYING_TYPES above — a place whose Google record is now a
  // transit hub / parking lot / gas station is rejected outright rather than
  // pinned under whatever category the AI originally suggested it as.
  if (types.some((type) => DISQUALIFYING_TYPES.has(type))) return null
  // `.trim() || fallback` (not `??`) deliberately treats a present-but-blank
  // displayName the same as a missing one — Google occasionally returns
  // `{ text: '' }` rather than omitting the field entirely.
  return { placeId: raw.id, name: raw.displayName?.text?.trim() || fallbackName, lat, lng, types, photoRef: raw.photos?.[0]?.name }
}

// Shared timeout wiring: bounds one Google fetch to REQUEST_TIMEOUT_MS,
// merged with an optional caller-supplied signal (e.g. the client
// disconnecting) so either one aborts the request — without it, a disconnect
// only cancels whatever's racing this call (a Claude stream, say) while this
// fetch keeps running and billing for the full REQUEST_TIMEOUT_MS regardless.
// Caller must call `clear()` once the fetch settles (success or failure) to
// release the timer.
function withTimeout(externalSignal?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutController.signal]) : timeoutController.signal
  return { signal, clear: () => clearTimeout(timer) }
}

// One raw Text Search call. Throws on network / non-2xx so the caller can
// decide whether to cache (genuine empty) or not (transient failure).
async function textSearch(
  apiKey: string,
  textQuery: string,
  bias: GeoPoint | null,
  includePhotos: boolean,
  externalSignal?: AbortSignal,
): Promise<VerifiedPlace | null> {
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

  const { signal, clear } = withTimeout(externalSignal)
  let response: Response
  try {
    response = await fetch(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Field mask is required by the Places API (New). location alone
        // makes this a Pro-tier call; places.photos (only requested when
        // includePhotos is set) bumps it to Enterprise tier (higher $/1000,
        // see Google's Places API SKU table) since photos isn't available at
        // Pro — a deliberate cost/feature tradeoff, scoped to only the calls
        // that actually use the photo. id/displayName/businessStatus/types
        // ride along at no extra tier cost either way.
        'X-Goog-FieldMask': `places.id,places.displayName,places.location,places.businessStatus,places.types${includePhotos ? ',places.photos' : ''}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  } finally {
    clear()
  }
  if (!response.ok) throw new Error(`Places search failed: ${response.status}`)

  const data = (await response.json()) as TextSearchResponse
  const first = data.places?.[0]
  if (!first) return null
  // Preserves textSearch's original fallback exactly: '' rather than the
  // query text, since its callers (verifyPlace → generate-trip-day.ts) fall
  // back further to the AI's own name, not to the geocode query string.
  const hit = parseHit(first, '')
  if (!hit) return null
  return { placeId: hit.placeId, name: hit.name, lat: hit.lat, lng: hit.lng, photoRef: hit.photoRef }
}

async function textSearchCached(
  apiKey: string,
  query: string,
  bias: GeoPoint | null,
  includePhotos: boolean,
  signal?: AbortSignal,
): Promise<VerifiedPlace | null> {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return null
  const key = `${includePhotos ? '1' : '0'}:${trimmed}`

  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const result = await textSearch(apiKey, query, bias, includePhotos, signal)
  cache.set(key, result)
  return result
}

// Haversine distance in km — the structural guard against a wrong-city hit
// slipping past the location bias. Exported: generate-trip-day.ts reuses this
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
export async function geocodeCityCenter(apiKey: string, destination: string, signal?: AbortSignal): Promise<GeoPoint | null> {
  try {
    const result = await textSearchCached(apiKey, destination, null, false, signal)
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
  signal?: AbortSignal,
): Promise<VerifiedPlace | null> {
  for (const query of queries) {
    if (!query?.trim()) continue
    let result: VerifiedPlace | null
    try {
      result = await textSearchCached(apiKey, query, cityCenter, true, signal)
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

// AddPlaceModal.vue's category chips → a single Google Places (New) Table A
// type, passed as Text Search's `includedType` to let Google filter
// server-side. includedType only accepts one type per request (not an
// array), so each chip maps to the single broadest type that covers it
// (confirmed against Google's place-types docs) rather than a precise OR of
// several narrower ones. No entry for 'other' — that chip is the unfiltered
// catch-all, so it deliberately omits includedType entirely. Exported (as a
// real literal union, not a bare string) so api/places-search.ts can validate
// a request body's `category` against it before it ever reaches this file —
// mirrors the `as const` PLACE_CATEGORIES pattern already used twice
// elsewhere in api/, rather than leaving the link untyped.
export const SEARCHABLE_CATEGORIES = ['food', 'attraction', 'shopping', 'stay'] as const
export type SearchableCategory = (typeof SEARCHABLE_CATEGORIES)[number]

const CATEGORY_SEARCH_TYPE: Record<SearchableCategory, string> = {
  food: 'restaurant',
  attraction: 'tourist_attraction',
  shopping: 'store',
  stay: 'lodging',
}

// The reverse direction of CATEGORY_SEARCH_TYPE, plus a few common synonyms
// Google returns that aren't themselves a chip's includedType (e.g. 'cafe'
// rather than 'restaurant') — lets a result found with no category chip
// selected get tagged with a real guessed category instead of
// AddPlaceModal.vue blindly defaulting everything to 'other' in that case.
// `types` is checked in order (first match wins), since Google returns the
// primary type first.
const GOOGLE_TYPE_TO_CATEGORY: Record<string, SearchableCategory> = {
  restaurant: 'food',
  cafe: 'food',
  bakery: 'food',
  bar: 'food',
  tourist_attraction: 'attraction',
  museum: 'attraction',
  art_gallery: 'attraction',
  park: 'attraction',
  amusement_park: 'attraction',
  zoo: 'attraction',
  aquarium: 'attraction',
  lodging: 'stay',
  hotel: 'stay',
  store: 'shopping',
  shopping_mall: 'shopping',
  supermarket: 'shopping',
  clothing_store: 'shopping',
}

function inferCategory(types: string[]): SearchableCategory | undefined {
  for (const type of types) {
    const category = GOOGLE_TYPE_TO_CATEGORY[type]
    if (category) return category
  }
  return undefined
}

export type PlaceSearchResult = {
  placeId: string
  name: string
  lat: number
  lng: number
  photoRef?: string
  // Best-guess app category inferred from Google's own place `types` (see
  // GOOGLE_TYPE_TO_CATEGORY) — absent when nothing in `types` matches. Only
  // set by searchPlaces, for its unfiltered case (AddPlaceModal.vue has no
  // category chip selected); nearbyPlaces below already knows its category
  // from the chip that triggered it, so it sets this directly instead.
  category?: SearchableCategory
}

// Multi-result Text Search backing AddPlaceModal's interactive search — unlike
// verifyPlace (exactly one AI-suggested name, confirmed against Google), this
// is a human browsing real candidates typed by hand, so it asks for up to
// SEARCH_RESULT_COUNT results and applies the same closed/disqualified-type
// AND distance-from-city checks verifyPlace does. Kept modest (not Google's
// max of 20) since every result here also pays for a photo (Enterprise tier,
// see the field mask below) that most of them will never be clicked for.
// Deliberately uncached (unlike textSearchCached above): callers are live
// keystrokes, where the query itself is the varying part and a photo-inclusive
// Enterprise-tier call isn't worth caching against the odds of an exact repeat.
const SEARCH_RESULT_COUNT = 6

export async function searchPlaces(
  apiKey: string,
  query: string,
  category: SearchableCategory | undefined,
  // Centroid of the day column the modal was opened from (already-added
  // places with real coordinates), when there are any — biases results
  // toward what's actually convenient to add to THAT day, not just
  // "somewhere in the city." Absent (empty day, or none of its places are
  // pinned yet) falls back to cityCenter, same as before this existed.
  dayAnchor: GeoPoint | null,
  cityCenter: GeoPoint | null,
  signal?: AbortSignal,
): Promise<PlaceSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const body: Record<string, unknown> = {
    textQuery: trimmed,
    languageCode: 'zh-TW',
    maxResultCount: SEARCH_RESULT_COUNT,
  }
  const { point: anchorPoint, radius } = resolveAnchor(dayAnchor, cityCenter)
  if (anchorPoint) {
    body.locationBias = { circle: { center: { latitude: anchorPoint.lat, longitude: anchorPoint.lng }, radius } }
  }
  const includedType = category ? CATEGORY_SEARCH_TYPE[category] : undefined
  if (includedType) body.includedType = includedType

  const { signal: combinedSignal, clear } = withTimeout(signal)

  try {
    const response = await fetch(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.businessStatus,places.types,places.photos',
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    })
    if (!response.ok) throw new Error(`Places search failed: ${response.status}`)

    const data = (await response.json()) as TextSearchResponse
    const results: PlaceSearchResult[] = []
    for (const place of data.places ?? []) {
      const hit = parseHit(place, trimmed)
      if (!hit) continue
      // Structural guard against a wrong-city fuzzy match, same as
      // verifyPlace above — locationBias only biases ranking, it doesn't
      // exclude, so without this a strongly-matching same-name place in a
      // different city could still surface with nothing in the UI to warn
      // the user it's ~100km+ away.
      if (cityCenter && distanceKm(cityCenter, { lat: hit.lat, lng: hit.lng }) > MAX_KM_FROM_CITY) continue
      results.push({
        placeId: hit.placeId,
        name: hit.name,
        lat: hit.lat,
        lng: hit.lng,
        photoRef: hit.photoRef,
        category: inferCategory(hit.types),
      })
    }
    return results
  } finally {
    clear()
  }
}

const NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby'

// One Nearby Search attempt around a single circle. Split out of
// nearbyPlaces so that function can retry with a wider circle without
// duplicating the request/parse logic (see nearbyPlaces' own comment on why
// a retry is needed at all).
async function fetchNearby(
  apiKey: string,
  category: SearchableCategory,
  anchorPoint: GeoPoint,
  radius: number,
  cityCenter: GeoPoint | null,
  signal?: AbortSignal,
): Promise<PlaceSearchResult[]> {
  const body = {
    locationRestriction: {
      circle: { center: { latitude: anchorPoint.lat, longitude: anchorPoint.lng }, radius },
    },
    includedTypes: [CATEGORY_SEARCH_TYPE[category]],
    maxResultCount: SEARCH_RESULT_COUNT,
    rankPreference: 'POPULARITY',
    languageCode: 'zh-TW',
  }

  const { signal: combinedSignal, clear } = withTimeout(signal)

  try {
    const response = await fetch(NEARBY_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.businessStatus,places.types,places.photos',
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    })
    if (!response.ok) throw new Error(`Nearby search failed: ${response.status}`)

    const data = (await response.json()) as TextSearchResponse
    const results: PlaceSearchResult[] = []
    for (const place of data.places ?? []) {
      // No user-typed text to fall back to here (unlike searchPlaces) — a
      // place with no real displayName has nothing meaningful to show, so
      // it's dropped rather than given a placeholder name.
      const hit = parseHit(place, '')
      if (!hit || !hit.name) continue
      // Same wrong-city guard searchPlaces applies, and same reasoning for
      // skipping it when cityCenter is unavailable — there's no city
      // reference to check distance against, and a day anchor on its own
      // (already within DAY_ANCHOR_RADIUS_M) doesn't need re-validating
      // against itself.
      if (cityCenter && distanceKm(cityCenter, { lat: hit.lat, lng: hit.lng }) > MAX_KM_FROM_CITY) continue
      // Already known from the chip that triggered this browse — every
      // result was explicitly requested via includedTypes above, so trust
      // that over re-deriving it from `types` (which could disagree if a
      // place carries multiple overlapping types).
      results.push({ placeId: hit.placeId, name: hit.name, lat: hit.lat, lng: hit.lng, photoRef: hit.photoRef, category })
    }
    return results
  } finally {
    clear()
  }
}

// Browse-by-category with no typed query yet — AddPlaceModal.vue's chip click
// while its search box is still empty. Unlike searchPlaces (Text Search),
// Nearby Search needs no query text at all: it takes a location + type and
// defaults to rankPreference: POPULARITY, genuinely surfacing well-known
// nearby places rather than whatever a synthesized keyword (e.g. "餐廳") would
// turn up via Text Search's relevance-only ranking. Needs SOME location to
// search around, but that can be `dayAnchor` alone — `cityCenter` is only
// actually used below for the wrong-city sanity check, not the search itself,
// so a destination-geocoding failure (cityCenter null) no longer disables
// this entirely as long as the day already has pinned places to anchor on
// (confirmed live: requiring cityCenter unconditionally meant one failed
// geocode disabled category browsing for the rest of the modal session).
export async function nearbyPlaces(
  apiKey: string,
  category: SearchableCategory,
  // Day-column centroid anchor — see resolveAnchor and searchPlaces'
  // identical parameter.
  dayAnchor: GeoPoint | null,
  cityCenter: GeoPoint | null,
  signal?: AbortSignal,
): Promise<PlaceSearchResult[]> {
  const { point: anchorPoint, radius } = resolveAnchor(dayAnchor, cityCenter)
  // Nothing to search around at all — no day anchor, and the destination
  // itself couldn't be geocoded either.
  if (!anchorPoint) return []

  const results = await fetchNearby(apiKey, category, anchorPoint, radius, cityCenter, signal)
  // Unlike searchPlaces' locationBias (a soft ranking preference),
  // locationRestriction is a hard filter for Nearby Search — DAY_ANCHOR_RADIUS_M's
  // tight 8km can legitimately come back with nothing in a sparse/suburban
  // day, where the identical anchor+category under Text Search would still
  // have found something farther away, just ranked lower. Rather than
  // showing "nothing found" when the city itself likely has some, retry once
  // widened to the whole destination. Only meaningful when the first attempt
  // actually used the tight radius (dayAnchor was set) and there's a
  // cityCenter to widen to — otherwise this was already the widest attempt.
  if (results.length > 0 || !dayAnchor || !cityCenter) return results
  return fetchNearby(apiKey, category, cityCenter, BIAS_RADIUS_M, cityCenter, signal)
}
