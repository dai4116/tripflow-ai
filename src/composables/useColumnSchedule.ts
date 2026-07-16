import { computeArrivalTimes } from '../data/placeSchedule'
import type { Place, TripColumn } from '../types'

export type ColumnCard = {
  place: Place
  order: number
  arrivalTime: string
  hasTimeOverlap: boolean
  overlapReason: 'arrival' | 'departure'
}

// Shared by TripBoardPage and ExploreTripBoardPage — both lay out a day
// column's cards from the same cascade and need to look a single place's
// resolved schedule back up for the drawer. `places`/`columns` are getters
// (not values) so this stays reactive to whichever store/computed each page
// reads its data from.
export function useColumnSchedule(places: () => Place[], columns: () => TripColumn[]) {
  function getColumnPlaces(placeIds: string[]): Place[] {
    const allPlaces = places()
    return placeIds
      .map((placeId) => allPlaces.find((place) => place.id === placeId))
      .filter((place): place is Place => place !== undefined)
  }

  // Bundles each place with its 1-based order and its resolved arrival time so
  // the template does one pass per column instead of recomputing the whole
  // day's cascade once per card.
  function getColumnCards(placeIds: string[]): ColumnCard[] {
    const columnPlaces = getColumnPlaces(placeIds)
    const schedule = computeArrivalTimes(columnPlaces)

    return columnPlaces.map((place, index) => ({
      place,
      order: index + 1,
      arrivalTime: schedule[index]!.time,
      hasTimeOverlap: schedule[index]!.hasOverlap || schedule[index]!.hasInvalidDeparture,
      overlapReason: schedule[index]!.hasInvalidDeparture ? ('departure' as const) : ('arrival' as const),
    }))
  }

  // The drawer only has the raw place, not where it falls in its day's
  // cascade — look up its column and resolve the same way the card does.
  function getPlaceSchedule(place: Place | null | undefined): ColumnCard | null {
    if (!place) return null

    const column = columns().find((item) => item.id === place.columnId)
    if (!column) return null

    return getColumnCards(column.placeIds).find((card) => card.place.id === place.id) ?? null
  }

  return { getColumnPlaces, getColumnCards, getPlaceSchedule }
}
