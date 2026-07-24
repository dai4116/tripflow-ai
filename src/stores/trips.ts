import { useStorage } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { fetchAiPlaces } from '../data/aiTripClient'
import { explorePlacesForTemplate, exploreTemplates } from '../data/exploreTrips'
import {
  cityFromDestination,
  computeTripDays,
  generateTrip,
  paceForTravelStyles,
  placesPerDayForPace,
  PLACE_GRADIENTS,
  regionFromDestination,
} from '../data/generateTrip'
import { geocodePlace, geocodeRawQuery } from '../data/geocode'
import { places as seedPlaces } from '../data/mockPlaces'
import { trips as seedTrips } from '../data/mockTrips'
import { fetchTravelTime } from '../data/routing'
import type { CreateTripInput, Place, PlaceCategory, Trip, TravelMode } from '../types'

function hasCoords(place: Place): boolean {
  return place.lat !== 0 || place.lng !== 0
}

export type NewPlaceInput = {
  tripId: string
  columnId: string
  name: string
  category: PlaceCategory
  description: string
  travelTip?: string
  geocodeQuery?: string
  geocodeQueryAlt?: string
}

export const useTripsStore = defineStore('trips', () => {
  // Bumped to v2 when the Planning/Done columns were removed from the board
  // structure, then to v3 when trips gained a startDate field — old
  // localStorage data under earlier keys is stale/incompatible, so browsers
  // with existing data fall back to the fresh seed instead of silently
  // missing fields the UI now expects.
  const trips = useStorage<Trip[]>('tripflow-trips-v3', seedTrips)
  const places = useStorage<Place[]>('tripflow-places-v3', seedPlaces)

  function getTripById(tripId: string) {
    return trips.value.find((trip) => trip.id === tripId)
  }

  function placesForTrip(tripId: string) {
    return places.value.filter((place) => place.tripId === tripId)
  }

  // Logged (not surfaced in the UI — TravelTimeModal's existing "地點尚未定位"
  // message already covers that) so a failed lookup can be diagnosed from the
  // browser console instead of guessing what query the AI actually produced.
  function logGeocodeFailure(placeName: string, queriesTried: string[]) {
    console.warn(
      `[geocode] 找不到「${placeName}」的地圖座標，已嘗試以下查詢字串：\n${queriesTried.map((q) => `  - ${q}`).join('\n')}`,
    )
  }

  // geocodeQuery (an AI-supplied, self-contained "place, city, country"
  // string in one consistent language) is looked up as-is — appending the
  // separately-derived Chinese city/region to it would mix scripts and break
  // the match (see geocodeRawQuery's comment in geocode.ts). If that lookup
  // comes back genuinely empty (not a network error — geocodeRawQuery
  // already only resolves null for a real no-match), retry once with
  // geocodeQueryAlt: the AI's own "official" name guess can be a compound
  // it assembled itself rather than what the map provider actually has
  // indexed (e.g. "Mercato Centrale di San Lorenzo" vs. the shorter
  // "Mercato Centrale" OSM knows). Places with no AI-supplied query at all
  // (manually added ones) fall back to the plain Chinese name + city/region
  // composition, same language throughout.
  function resolveNewPlaceCoords(newPlace: Place, city: string, region: string) {
    if (!newPlace.geocodeQuery) {
      return geocodePlace(newPlace.name, city, region).then((point) => {
        if (!point) logGeocodeFailure(newPlace.name, [[newPlace.name, city, region].filter(Boolean).join(', ')])
        return point
      })
    }
    return geocodeRawQuery(newPlace.geocodeQuery).then((point) => {
      if (point) return point
      if (!newPlace.geocodeQueryAlt) {
        logGeocodeFailure(newPlace.name, [newPlace.geocodeQuery!])
        return null
      }
      return geocodeRawQuery(newPlace.geocodeQueryAlt).then((altPoint) => {
        if (!altPoint) logGeocodeFailure(newPlace.name, [newPlace.geocodeQuery!, newPlace.geocodeQueryAlt!])
        return altPoint
      })
    })
  }

  // Places generated through createTrip are now verified server-side against
  // Google Places and arrive WITH real coordinates (see api/generate-trip.ts),
  // so most of the time there's nothing to geocode here. This client-side
  // Nominatim path is only for places that still start at 0,0: manually added
  // places (AddPlaceModal), and AI places from the no-Google-key interim path.
  // It runs in the background — geocodePlace's queue is rate-limited to
  // ~1 req/sec — and the map picks up each pin as it resolves.
  function geocodeNewPlaces(newPlaces: Place[], destination: string) {
    const city = cityFromDestination(destination)
    const region = regionFromDestination(destination)

    // Already-placed (server-verified) places don't fire a geocode callback,
    // so their walking-time gaps would never get filled by the per-place
    // callback below — trigger one fill pass up front for them.
    if (newPlaces.some((place) => hasCoords(place))) {
      const tripId = newPlaces[0]?.tripId
      if (tripId) fillMissingTravelTimes(tripId)
    }

    for (const newPlace of newPlaces) {
      if (hasCoords(newPlace)) continue // already positioned by Google — skip Nominatim
      resolveNewPlaceCoords(newPlace, city, region).then((point) => {
        if (!point) return
        const target = places.value.find((item) => item.id === newPlace.id)
        if (target) {
          target.lat = point.lat
          target.lng = point.lng
        }
        // This place may have just become the missing half of a walking-time
        // gap (its neighbor might already have coords) — check the whole
        // trip again rather than trying to work out which specific gaps this
        // one geocode result unblocked.
        fillMissingTravelTimes(newPlace.tripId)
      })
    }
  }

  // Tracks gaps with a fetch in flight so overlapping calls (e.g. several
  // places in the same trip finishing geocoding close together) don't each
  // kick off their own request for the same from→to pair.
  const pendingTravelFetches = new Set<string>()

  // Auto-fills walking time for adjacent places within a day that don't have
  // it yet (or whose stored travelToNext points at a place that's no longer
  // actually next — see the TravelToNext type comment). Driving/cycling stay
  // opt-in via the picker; walking is the one mode shown without the user
  // having to ask, same as chicTrip defaults to for short hops. Safe to call
  // repeatedly — already-valid pairs and in-flight ones are skipped.
  function fillMissingTravelTimes(tripId: string) {
    const trip = trips.value.find((item) => item.id === tripId)
    if (!trip) return

    // Built once per call instead of two places.value.find() per gap —
    // O(places) instead of O(places × gaps) for the whole scan.
    const placesById = new Map(places.value.map((item) => [item.id, item]))

    for (const column of trip.columns) {
      for (let i = 0; i < column.placeIds.length - 1; i++) {
        const fromId = column.placeIds[i]!
        const toId = column.placeIds[i + 1]!
        const gapKey = `${fromId}->${toId}`
        if (pendingTravelFetches.has(gapKey)) continue

        const fromPlace = placesById.get(fromId)
        const toPlace = placesById.get(toId)
        if (!fromPlace || !toPlace) continue
        if (fromPlace.travelToNext?.toPlaceId === toId) continue
        // A reorder can leave travelToNext pointing at a place that's no
        // longer next (stale). If the stale value was itself an auto walking
        // estimate, it's fine to silently replace below. But if the user
        // deliberately picked driving/cycling/manual for the OLD pairing,
        // leave it alone rather than clobbering their choice with an
        // unrequested walking guess for the new one — this also means the
        // original choice comes back correctly if the old adjacency returns
        // (e.g. a place inserted between two others gets removed again).
        if (fromPlace.travelToNext && fromPlace.travelToNext.mode !== 'walking') continue
        if (!hasCoords(fromPlace) || !hasCoords(toPlace)) continue

        pendingTravelFetches.add(gapKey)
        fetchTravelTime('walking', { lat: fromPlace.lat, lng: fromPlace.lng }, { lat: toPlace.lat, lng: toPlace.lng })
          .then((estimate) => {
            if (!estimate) return
            // Re-check adjacency at resolution time, not just at request
            // time — a reorder could have landed while this was in flight.
            const currentTrip = trips.value.find((item) => item.id === tripId)
            const currentColumn = currentTrip?.columns.find((item) => item.id === column.id)
            const currentIndex = currentColumn?.placeIds.indexOf(fromId) ?? -1
            if (currentColumn?.placeIds[currentIndex + 1] !== toId) return

            const target = places.value.find((item) => item.id === fromId)
            if (target) {
              target.travelToNext = { toPlaceId: toId, mode: 'walking', durationMin: estimate.durationMin, distanceKm: estimate.distanceKm }
            }
          })
          .finally(() => pendingTravelFetches.delete(gapKey))
      }
    }
  }

  // Used by the travel-mode picker — driving/cycling only get calculated
  // when the user asks, and manual entries never touch routing.ts at all.
  function setTravelToNext(fromPlaceId: string, toPlaceId: string, mode: TravelMode, durationMin: number, distanceKm?: number) {
    const place = places.value.find((item) => item.id === fromPlaceId)
    if (place) place.travelToNext = { toPlaceId, mode, durationMin, distanceKm }
  }

  // Throws rather than silently falling back to the local CATEGORY_TEMPLATES
  // generator on AI failure — this app's whole pitch is an AI-built
  // itinerary, so handing back generic canned places without saying so would
  // look like a real (if bland) result instead of the failure it actually
  // is. CreateTripPage.vue catches this and shows a retry prompt instead of
  // navigating to a trip board. Trade-off: this also means trip creation
  // hard-fails whenever /api/generate-trip is unreachable — including plain
  // `vite dev` locally (no serverless routes there) and a misconfigured/
  // missing ANTHROPIC_API_KEY in prod — there is no more silent degrade path.
  async function createTrip(input: CreateTripInput): Promise<Trip> {
    const days = computeTripDays(input)
    const placesPerDay = placesPerDayForPace(paceForTravelStyles(input.travelStyle))
    const aiPlaces = await fetchAiPlaces(input, days * placesPerDay, days, placesPerDay)
    if (!aiPlaces) throw new Error('AI trip generation failed')

    const { trip, places: newPlaces } = generateTrip(
      input,
      trips.value.map((existing) => existing.id),
      aiPlaces,
      placesPerDay,
    )
    trips.value.push(trip)
    places.value.push(...newPlaces)
    geocodeNewPlaces(newPlaces, trip.destination)
    return trip
  }

  // Derives placeCount from the columns themselves rather than tracking a
  // counter by hand, so add/remove/move can't drift out of sync.
  function recalcPlaceCount(trip: Trip) {
    trip.placeCount = trip.columns.reduce((sum, column) => sum + column.placeIds.length, 0)
  }

  function addPlace(input: NewPlaceInput): Place | undefined {
    const trip = trips.value.find((item) => item.id === input.tripId)
    const column = trip?.columns.find((item) => item.id === input.columnId)
    if (!trip || !column) return undefined

    const place: Place = {
      id: nanoid(8),
      tripId: input.tripId,
      name: input.name,
      category: input.category,
      estimatedTime: 1,
      address: trip.destination,
      lat: 0,
      lng: 0,
      description: input.description,
      travelTip: input.travelTip,
      geocodeQuery: input.geocodeQuery,
      geocodeQueryAlt: input.geocodeQueryAlt,
      columnId: input.columnId,
      imageGradient: PLACE_GRADIENTS[places.value.length % PLACE_GRADIENTS.length],
    }

    places.value.push(place)
    column.placeIds.push(place.id)
    recalcPlaceCount(trip)
    geocodeNewPlaces([place], trip.destination)

    return place
  }

  function removePlace(placeId: string) {
    const place = places.value.find((item) => item.id === placeId)
    if (!place) return

    const trip = trips.value.find((item) => item.id === place.tripId)
    const column = trip?.columns.find((item) => item.id === place.columnId)
    if (column) column.placeIds = column.placeIds.filter((id) => id !== placeId)

    places.value = places.value.filter((item) => item.id !== placeId)
    if (trip) {
      recalcPlaceCount(trip)
      // The place before the removed one now has a different (or no) next
      // place — its old travelToNext.toPlaceId check in fillMissingTravelTimes
      // will already correctly treat that as stale, this just re-triggers it.
      fillMissingTravelTimes(trip.id)
    }
  }

  function movePlaceToColumn(placeId: string, columnId: string) {
    const place = places.value.find((item) => item.id === placeId)
    if (!place || place.columnId === columnId) return

    const trip = trips.value.find((item) => item.id === place.tripId)
    const toColumn = trip?.columns.find((item) => item.id === columnId)
    if (!trip || !toColumn) return

    const fromColumn = trip.columns.find((item) => item.id === place.columnId)
    if (fromColumn) fromColumn.placeIds = fromColumn.placeIds.filter((id) => id !== placeId)
    toColumn.placeIds.push(placeId)
    place.columnId = columnId
    recalcPlaceCount(trip)
    fillMissingTravelTimes(trip.id)
  }

  function updatePlace(
    placeId: string,
    patch: Partial<
      Pick<
        Place,
        | 'name'
        | 'category'
        | 'estimatedTime'
        | 'description'
        | 'travelTip'
        | 'arrivalTime'
        | 'scheduleMode'
        | 'departureTime'
      >
    >,
  ) {
    const place = places.value.find((item) => item.id === placeId)
    if (place) Object.assign(place, patch)
  }

  function removeTrip(tripId: string) {
    places.value = places.value.filter((place) => place.tripId !== tripId)
    trips.value = trips.value.filter((trip) => trip.id !== tripId)
  }

  // Clones an Explore template into the user's own trips/places with fresh
  // ids, so editing the copy can never mutate the shared template data.
  function copyTemplateTrip(templateId: string): Trip | undefined {
    const template = exploreTemplates.find((item) => item.id === templateId)
    if (!template) return undefined

    const tripId = `${template.id}-${nanoid(6)}`
    const idMap = new Map<string, string>()

    const newPlaces: Place[] = explorePlacesForTemplate(template.id).map((place) => {
      const newId = nanoid(8)
      idMap.set(place.id, newId)
      return { ...place, id: newId, tripId }
    })

    const columns = template.columns.map((column) => ({
      ...column,
      placeIds: column.placeIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)),
    }))

    const trip: Trip = {
      id: tripId,
      title: template.title,
      destination: template.destination,
      days: template.days,
      travelers: template.travelers,
      placeCount: 0,
      color: template.color,
      imageGradient: template.imageGradient,
      dateRange: '尚未安排日期',
      preferences: [...template.preferences],
      pace: template.pace,
      columns,
    }
    recalcPlaceCount(trip)

    trips.value.push(trip)
    places.value.push(...newPlaces)
    // Unlike createTrip/addPlace, these places already have real coordinates
    // (hand-curated in exploreTrips.ts) — nothing async needs to resolve
    // first, so this can run immediately instead of waiting on a geocode
    // callback that will never fire for this path.
    fillMissingTravelTimes(trip.id)
    return trip
  }

  return {
    trips,
    places,
    getTripById,
    placesForTrip,
    createTrip,
    addPlace,
    removePlace,
    movePlaceToColumn,
    updatePlace,
    recalcPlaceCount,
    removeTrip,
    copyTemplateTrip,
    fillMissingTravelTimes,
    setTravelToNext,
  }
})
