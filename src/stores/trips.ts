import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { generateTrip } from '../data/generateTrip'
import { places as seedPlaces } from '../data/mockPlaces'
import { trips as seedTrips } from '../data/mockTrips'
import type { CreateTripInput, Place, Trip } from '../types'

export const useTripsStore = defineStore('trips', () => {
  const trips = useStorage<Trip[]>('tripflow-trips', seedTrips)
  const places = useStorage<Place[]>('tripflow-places', seedPlaces)

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

  return { trips, places, getTripById, placesForTrip, createTrip }
})
