import assert from 'node:assert/strict'
import test from 'node:test'

import { googleMapsDirectionsUrl, googleMapsPlaceUrl } from './googleMapsUrl.ts'

test('googleMapsDirectionsUrl uses coordinates and place id when both are available', () => {
  const url = googleMapsDirectionsUrl({
    lat: 25.033,
    lng: 121.5654,
    address: '台北市信義區',
    name: '台北101',
    placeId: 'ChIJ_abc123',
  })

  assert.equal(
    url,
    'https://www.google.com/maps/dir/?api=1&destination=25.033%2C121.5654&destination_place_id=ChIJ_abc123',
  )
})

test('googleMapsDirectionsUrl omits destination_place_id when there is no place id', () => {
  const url = googleMapsDirectionsUrl({ lat: 25.033, lng: 121.5654, address: '台北市信義區', name: '台北101' })

  assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=25.033%2C121.5654')
})

test('googleMapsDirectionsUrl falls back to the address when coordinates are 0,0', () => {
  const url = googleMapsDirectionsUrl({
    lat: 0,
    lng: 0,
    address: '桃園國際機場第二航廈',
    name: '抵達機場',
    placeId: 'ChIJ_should_be_ignored',
  })

  assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=%E6%A1%83%E5%9C%92%E5%9C%8B%E9%9A%9B%E6%A9%9F%E5%A0%B4%E7%AC%AC%E4%BA%8C%E8%88%AA%E5%BB%88')
})

test('googleMapsDirectionsUrl falls back to the name when coordinates and address are both empty', () => {
  const url = googleMapsDirectionsUrl({ lat: 0, lng: 0, address: '', name: '抵達機場' })

  assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=%E6%8A%B5%E9%81%94%E6%A9%9F%E5%A0%B4')
})

test('googleMapsPlaceUrl opens a place search by name with a place id', () => {
  const url = googleMapsPlaceUrl({
    lat: 25.033,
    lng: 121.5654,
    address: '台北市信義區',
    name: '台北101',
    placeId: 'ChIJ_abc123',
  })

  assert.equal(
    url,
    'https://www.google.com/maps/search/?api=1&query=%E5%8F%B0%E5%8C%97101&query_place_id=ChIJ_abc123',
  )
})

test('googleMapsPlaceUrl falls back to the address for placeholder places', () => {
  const url = googleMapsPlaceUrl({ lat: 0, lng: 0, address: '桃園國際機場第二航廈', name: '抵達機場' })

  assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=%E6%A1%83%E5%9C%92%E5%9C%8B%E9%9A%9B%E6%A9%9F%E5%A0%B4%E7%AC%AC%E4%BA%8C%E8%88%AA%E5%BB%88')
})

test('googleMapsPlaceUrl uses the place id embedded in a Google photo reference', () => {
  const url = googleMapsPlaceUrl({
    lat: 34.9858,
    lng: 135.7588,
    address: '京都・京都車站',
    name: '京都拉麵小路',
    photoRef: 'places/ChIJKRpFOpoIAWARfMEVANUDooo/photos/AWCwydg_example',
  })

  assert.equal(
    url,
    'https://www.google.com/maps/search/?api=1&query=%E4%BA%AC%E9%83%BD%E6%8B%89%E9%BA%B5%E5%B0%8F%E8%B7%AF&query_place_id=ChIJKRpFOpoIAWARfMEVANUDooo',
  )
})

test('googleMapsPlaceUrl keeps coordinate searches precise when no place id is available', () => {
  const url = googleMapsPlaceUrl({ lat: 34.9858, lng: 135.7588, address: '京都・京都車站', name: '京都拉麵小路' })

  assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=34.9858%2C135.7588')
})
