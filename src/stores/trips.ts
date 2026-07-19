import { useStorage } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { fetchAiPlaces } from '../data/aiTripClient'
import { explorePlacesForTemplate, exploreTemplates } from '../data/exploreTrips'
import { cityFromDestination, computeTripDays, generateTrip, PLACE_GRADIENTS } from '../data/generateTrip'
import { geocodePlace } from '../data/geocode'
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

  // AI generation deliberately never guesses lat/lng (see generateTrip.ts),
  // so every new place starts at 0,0 and gets its real coordinates here,
  // one Nominatim lookup at a time. Fires in the background rather than
  // blocking trip creation — geocodePlace's own queue is rate-limited to
  // ~1 req/sec, which would otherwise stall a multi-day itinerary for
  // several seconds. The map just picks up each pin as it resolves.
  function geocodeNewPlaces(newPlaces: Place[], destination: string) {
    const city = cityFromDestination(destination)
    for (const newPlace of newPlaces) {
      geocodePlace(newPlace.name, city).then((point) => {
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

  async function createTrip(input: CreateTripInput): Promise<Trip> {
    const days = computeTripDays(input)
    const aiPlaces = await fetchAiPlaces(input, days * 2)
    const { trip, places: newPlaces } = generateTrip(
      input,
      trips.value.map((existing) => existing.id),
      aiPlaces,
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
      rating: '4.5',
      description: input.description,
      travelTip: input.travelTip,
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
