import assert from 'node:assert/strict'
import test from 'node:test'

import {
  explorePlaces,
  explorePlacesForTemplate,
  exploreTemplates,
  MIN_EXPLORE_PLACES_PER_DAY,
} from './exploreTrips.ts'

test('explore templates have complete, consistently assigned daily stops', () => {
  for (const template of exploreTemplates) {
    const places = explorePlacesForTemplate(template.id)
    const placesById = new Map(places.map((place) => [place.id, place]))

    assert.equal(places.length, template.placeCount, `${template.title} should report its actual place count`)
    assert.equal(template.columns.length, template.days, `${template.title} should have one column per day`)

    for (const column of template.columns) {
      assert.ok(
        column.placeIds.length >= MIN_EXPLORE_PLACES_PER_DAY,
        `${template.title} ${column.title} should contain at least ${MIN_EXPLORE_PLACES_PER_DAY} stops`,
      )
      assert.equal(new Set(column.placeIds).size, column.placeIds.length, `${template.title} ${column.title} has duplicate stops`)

      for (const placeId of column.placeIds) {
        const place = placesById.get(placeId)

        assert.ok(place, `${template.title} ${column.title} references an unknown place: ${placeId}`)
        assert.equal(place.columnId, column.id, `${place.name} belongs to the wrong day`)
        assert.ok(place.name.trim().length > 0, `${placeId} needs a name`)
        assert.ok(Number.isFinite(place.lat) && Number.isFinite(place.lng), `${place.name} needs coordinates`)
      }
    }
  }
})

test('explore templates exclude date-dependent and generic placeholder locations', () => {
  const outdatedPlaceholderNames = new Set([
    '河畔晚餐',
    '河畔咖啡廳',
    '寧曼路咖啡廳',
    '週日夜市',
    '苗族山村',
    '傳統泰式按摩體驗',
    '天空酒吧',
  ])

  for (const place of explorePlaces) {
    assert.ok(!outdatedPlaceholderNames.has(place.name), `${place.name} must be replaced with a named place`)
    assert.doesNotMatch(place.name, /週日|週末|機場/, `${place.name} depends on a date or flight context the template does not have`)
  }
})
