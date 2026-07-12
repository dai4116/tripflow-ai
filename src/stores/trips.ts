import { useStorage } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { generateTrip, PLACE_GRADIENTS } from '../data/generateTrip'
import { places as seedPlaces } from '../data/mockPlaces'
import { trips as seedTrips } from '../data/mockTrips'
import type { CreateTripInput, Place, PlaceCategory, Trip } from '../types'

export type NewPlaceInput = {
  tripId: string
  columnId: string
  name: string
  category: PlaceCategory
  description: string
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

  function createTrip(input: CreateTripInput): Trip {
    const { trip, places: newPlaces } = generateTrip(
      input,
      trips.value.map((existing) => existing.id),
    )
    trips.value.push(trip)
    places.value.push(...newPlaces)
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
      estimatedTime: 1.5,
      estimatedCost: '$',
      address: trip.destination,
      lat: 0,
      lng: 0,
      rating: '4.5',
      description: input.description,
      columnId: input.columnId,
      imageGradient: PLACE_GRADIENTS[places.value.length % PLACE_GRADIENTS.length],
    }

    places.value.push(place)
    column.placeIds.push(place.id)
    recalcPlaceCount(trip)

    return place
  }

  function removePlace(placeId: string) {
    const place = places.value.find((item) => item.id === placeId)
    if (!place) return

    const trip = trips.value.find((item) => item.id === place.tripId)
    const column = trip?.columns.find((item) => item.id === place.columnId)
    if (column) column.placeIds = column.placeIds.filter((id) => id !== placeId)

    places.value = places.value.filter((item) => item.id !== placeId)
    if (trip) recalcPlaceCount(trip)
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
  }

  function updatePlace(placeId: string, patch: Partial<Pick<Place, 'name' | 'category' | 'estimatedTime' | 'estimatedCost' | 'description' | 'travelTip'>>) {
    const place = places.value.find((item) => item.id === placeId)
    if (place) Object.assign(place, patch)
  }

  function removeTrip(tripId: string) {
    places.value = places.value.filter((place) => place.tripId !== tripId)
    trips.value = trips.value.filter((trip) => trip.id !== tripId)
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
  }
})
