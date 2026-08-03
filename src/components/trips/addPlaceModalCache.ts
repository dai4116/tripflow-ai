import type { GeoPoint, PlaceSearchResult } from '../../data/placesSearchClient'
import type { PlaceCategory } from '../../types'

// True module-level state for AddPlaceModal.vue — a plain top-level `const`
// inside that file's <script setup> looks module-level but isn't: Vue
// compiles <script setup> into the component's setup() function, and
// TripBoardPage.vue mounts the modal with `v-if`, so every close/reopen is a
// fresh instance and a fresh setup() call. Declaring this state in its own
// module instead means it's evaluated once and actually shared across every
// mount, which is what "survives closing and reopening the modal" requires.

// Keyed by columnId so different days never share state. (The actual
// duplicate-add safety net lives in stores/trips.ts's addPlace, keyed by
// Google placeId across the whole trip — this Set is just what keeps an
// already-added place out of the visible list, so re-showing it here is a
// UX nicety, not a correctness guard.)
const addedPlaceIdsByColumn = new Map<string, Set<string>>()
export function addedPlaceIdsFor(columnId: string): Set<string> {
  let set = addedPlaceIdsByColumn.get(columnId)
  if (!set) {
    set = new Set()
    addedPlaceIdsByColumn.set(columnId, set)
  }
  return set
}

// A trip's city center never changes, so once resolved it stays valid across
// the whole trip, not just one modal session. `undefined` means "not
// resolved yet"; a resolution that came back `null` (destination geocoding
// failed — often transient: a rate limit, a timeout) is deliberately NOT
// cached, so the NEXT search retries the geocode server-side instead of
// getting stuck with no cityCenter for the rest of the trip.
export const cityCenterByDestination = new Map<string, GeoPoint>()

// A category-only browse (no typed query) is deterministic for a given
// (day column, category, anchor) — Google returns the same POPULARITY-ranked
// list every time, so re-visiting a chip already browsed for this day (even
// across closing and reopening the modal) reuses that fetch instead of
// billing Google again. Keyed by column so different days never share a
// cache, and each entry remembers the dayAnchor it was fetched under so one
// that's since shifted (the day gained/lost a pinned place, changing what
// "nearby" means) is treated as stale and re-fetched, rather than nuking
// every cached category just because any one of them went stale. Only
// applies to the no-query browse path (see runSearch) — a typed query is
// never cached, since every keystroke is a genuinely different search.
export type CategoryCacheEntry = { dayAnchor: GeoPoint | null; results: PlaceSearchResult[] }
export const categoryResultsCache = new Map<string, CategoryCacheEntry>()
export function categoryCacheKey(columnId: string, category: PlaceCategory): string {
  return `${columnId}:${category}`
}
export function sameAnchor(a: GeoPoint | null, b: GeoPoint | null): boolean {
  return a === null || b === null ? a === b : a.lat === b.lat && a.lng === b.lng
}
