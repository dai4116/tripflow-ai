import { mount } from '@vue/test-utils'
import { defineComponent, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Place } from '../types'
import { usePlacePhoto } from './usePlacePhoto'

function place(overrides: Partial<Place> & { id: string }): Place {
  return {
    tripId: 't1',
    name: 'Place',
    category: 'attraction',
    estimatedTime: 1,
    address: '京都',
    lat: 0,
    lng: 0,
    description: 'd',
    columnId: 'day-1',
    ...overrides,
  }
}

function mountHook(initialPlace: Place | null, widthPx = 64) {
  const placeRef: Ref<Place | null | undefined> = ref(initialPlace)
  const host = defineComponent({
    setup() {
      return { placeRef, ...usePlacePhoto(placeRef, widthPx) }
    },
    template: '<div />',
  })
  const wrapper = mount(host)
  return { wrapper, placeRef }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePlacePhoto', () => {
  it('is immediately ready with no photo to show when the place has no photoRef', () => {
    const { wrapper } = mountHook(place({ id: 'p1' }))
    expect(wrapper.vm.showPhoto).toBe(false)
    expect(wrapper.vm.ready).toBe(true)
  })

  it('is not ready while a real photo is still loading, and builds the URL with the requested width', () => {
    const { wrapper } = mountHook(place({ id: 'p1', photoRef: 'places/abc/photos/xyz' }), 128)
    expect(wrapper.vm.showPhoto).toBe(true)
    expect(wrapper.vm.ready).toBe(false)
    expect(wrapper.vm.photoUrl).toBe('/api/place-photo?ref=places%2Fabc%2Fphotos%2Fxyz&w=128')
  })

  it('becomes ready once the photo reports loaded', async () => {
    const { wrapper } = mountHook(place({ id: 'p1', photoRef: 'places/abc/photos/xyz' }))
    wrapper.vm.onPhotoLoad()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.ready).toBe(true)
  })

  it('falls back to the placeholder and is ready once the photo errors', async () => {
    const { wrapper } = mountHook(place({ id: 'p1', photoRef: 'places/abc/photos/xyz' }))
    wrapper.vm.onPhotoError()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showPhoto).toBe(false)
    expect(wrapper.vm.ready).toBe(true)
  })

  it('becomes ready via timeout if the photo never reports loaded or errored', async () => {
    const { wrapper } = mountHook(place({ id: 'p1', photoRef: 'places/abc/photos/xyz' }))
    expect(wrapper.vm.ready).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.vm.ready).toBe(true)
    // Still showing the real photo slot (not the placeholder) — the timeout
    // is just a "reveal the card anyway" escape hatch, not a failure.
    expect(wrapper.vm.showPhoto).toBe(true)
  })

  it('resets loaded/failed/timeout state when the place changes, and restarts the timeout clock', async () => {
    const { wrapper, placeRef } = mountHook(place({ id: 'p1', photoRef: 'places/abc/photos/xyz' }))
    wrapper.vm.onPhotoLoad()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.ready).toBe(true)

    placeRef.value = place({ id: 'p2', photoRef: 'places/def/photos/uvw' })
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.ready).toBe(false) // p2's own photo hasn't loaded yet

    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.vm.ready).toBe(true) // p2's own timeout, not a leftover from p1
  })
})
