import assert from 'node:assert/strict'
import test from 'node:test'

import { googleMapsDirectionsUrl } from './googleMapsUrl.ts'

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
