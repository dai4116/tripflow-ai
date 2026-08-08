import type { Place } from '../types'

// Airport placeholder places (see Place.skipGeocode) sit at 0,0 on purpose —
// routing a destination there would send users to Null Island, so fall back
// to a text query Google Maps can resolve on its own.
export function googleMapsDirectionsUrl(place: Pick<Place, 'lat' | 'lng' | 'address' | 'name' | 'placeId'>): string {
  const hasCoords = Boolean(place.lat || place.lng)
  const params = new URLSearchParams({
    api: '1',
    destination: hasCoords ? `${place.lat},${place.lng}` : place.address || place.name,
  })

  if (hasCoords && place.placeId) params.set('destination_place_id', place.placeId)

  return `https://www.google.com/maps/dir/?${params.toString()}`
}
