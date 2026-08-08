import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlaceSearchResult, PlacesSearchResponse } from '../../data/placesSearchClient'
import * as placesSearchClient from '../../data/placesSearchClient'
import AddPlaceModal from './AddPlaceModal.vue'

function searchResult(overrides: Partial<PlaceSearchResult> = {}): PlaceSearchResult {
  return { placeId: 'g1', name: '清水寺', lat: 34.99, lng: 135.78, ...overrides }
}

let columnCounter = 0
// addPlaceModalCache.ts is deliberately module-level shared state (see its
// own comment — it has to survive the modal closing/reopening). A fresh
// columnId per test sidesteps that instead of fighting it.
function mountModal(props: Partial<InstanceType<typeof AddPlaceModal>['$props']> = {}) {
  columnCounter += 1
  return mount(AddPlaceModal, {
    props: {
      columnId: `day-${columnCounter}`,
      columnTitle: `第${columnCounter}天`,
      city: '京都',
      destination: '京都，日本',
      dayAnchor: null,
      ...props,
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('AddPlaceModal', () => {
  it('shows the unfiltered empty state with nothing typed and no category selected', () => {
    const wrapper = mountModal()
    expect(wrapper.text()).toContain('輸入地點名稱開始搜尋')
  })

  it('close button emits close', async () => {
    const wrapper = mountModal()
    await wrapper.find('.add-place-modal__close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('close button emits close on the sheet variant too', async () => {
    const wrapper = mountModal({ sheet: true })
    await wrapper.find('.add-place-modal__close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('clicking a category chip searches and renders results, using the chip as the category', async () => {
    const response: PlacesSearchResponse = { results: [searchResult()], cityCenter: null }
    vi.spyOn(placesSearchClient, 'searchPlaces').mockResolvedValue(response)

    const wrapper = mountModal()
    const chips = wrapper.findAll('.preference-chip')
    const foodChip = chips.find((c) => c.text() === '美食')!
    await foodChip.trigger('click')
    await flushPromises()

    expect(foodChip.classes()).toContain('preference-chip--selected')
    expect(wrapper.findAll('.add-place-suggestion')).toHaveLength(1)
    expect(wrapper.text()).toContain('清水寺')
  })

  it('clicking a selected chip again deselects it and clears back to the unfiltered state', async () => {
    vi.spyOn(placesSearchClient, 'searchPlaces').mockResolvedValue({ results: [searchResult()], cityCenter: null })
    const wrapper = mountModal()
    const foodChip = wrapper.findAll('.preference-chip').find((c) => c.text() === '美食')!

    await foodChip.trigger('click')
    await flushPromises()
    await foodChip.trigger('click')
    await flushPromises()

    expect(foodChip.classes()).not.toContain('preference-chip--selected')
    expect(wrapper.text()).toContain('輸入地點名稱開始搜尋')
  })

  it('picking a result emits add with the selected chip as category, and removes it from the list', async () => {
    vi.spyOn(placesSearchClient, 'searchPlaces').mockResolvedValue({
      results: [searchResult({ category: 'shopping' })], // Google's own guess — the chip should win instead
      cityCenter: null,
    })
    const wrapper = mountModal()
    const foodChip = wrapper.findAll('.preference-chip').find((c) => c.text() === '美食')!
    await foodChip.trigger('click')
    await flushPromises()

    await wrapper.find('.add-place-suggestion').trigger('click')

    const added = wrapper.emitted('add')!
    expect(added).toHaveLength(1)
    expect(added[0]![0]).toMatchObject({ name: '清水寺', category: 'food', placeId: 'g1' })
    expect(wrapper.findAll('.add-place-suggestion')).toHaveLength(0)
  })

  it('picking a result with no chip selected falls back to Google\'s inferred category, then "other"', async () => {
    vi.spyOn(placesSearchClient, 'searchPlaces').mockResolvedValueOnce({
      results: [searchResult({ placeId: 'g-inferred', category: 'shopping' })],
      cityCenter: null,
    })
    const wrapper = mountModal()
    await wrapper.find('input').setValue('清水寺')
    await vi.waitFor(() => expect(placesSearchClient.searchPlaces).toHaveBeenCalled(), { timeout: 1000 })
    await flushPromises()

    await wrapper.find('.add-place-suggestion').trigger('click')
    expect(wrapper.emitted('add')![0]![0]).toMatchObject({ category: 'shopping' })
  })

  it('shows a failure message when the search fails', async () => {
    vi.spyOn(placesSearchClient, 'searchPlaces').mockResolvedValue(undefined)
    const wrapper = mountModal()
    const foodChip = wrapper.findAll('.preference-chip').find((c) => c.text() === '美食')!
    await foodChip.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('搜尋發生問題')
  })

  describe('swipe-down-to-close (sheet variant)', () => {
    // Component reads Date.now() (not PointerEvent.timeStamp — see
    // AddPlaceModal.vue's onDragStart comment) precisely so drag duration can
    // be controlled deterministically here via fake timers instead of real
    // wall-clock delay between trigger() calls.
    async function drag(wrapper: ReturnType<typeof mountModal>, distance: number, elapsedMs: number) {
      vi.useFakeTimers()
      try {
        const header = wrapper.find('.add-place-modal__header')
        await header.trigger('pointerdown', { pointerId: 1, clientY: 0 })
        vi.advanceTimersByTime(elapsedMs)
        await header.trigger('pointermove', { pointerId: 1, clientY: distance })
        await header.trigger('pointerup', { pointerId: 1, clientY: distance })
      } finally {
        vi.useRealTimers()
      }
    }

    it('does not render a drag handle or respond to drag when not a sheet', async () => {
      const wrapper = mountModal({ sheet: false })
      expect(wrapper.find('.add-place-modal__handle').exists()).toBe(false)

      await drag(wrapper, 200, 300)
      expect(wrapper.emitted('close')).toBeUndefined()
    })

    it('renders a drag handle for the sheet variant', () => {
      const wrapper = mountModal({ sheet: true })
      expect(wrapper.find('.add-place-modal__handle').exists()).toBe(true)
    })

    // Regression: a pointerdown that starts on the close button bubbles up to
    // the header's own pointerdown listener too. If that listener started a
    // drag (setPointerCapture) regardless of where the pointerdown actually
    // originated, a real browser retargets the tap's eventual click to
    // whichever element captured the pointer — the header, not the button —
    // silently swallowing the tap instead of closing the modal (confirmed
    // live in a real browser on the mobile sheet layout; jsdom/happy-dom's
    // synthetic click dispatch doesn't model that retargeting, so this test
    // instead asserts on the drag state directly, via dragStyle's transform).
    it('does not start a drag when the pointerdown originates on the close button', async () => {
      const wrapper = mountModal({ sheet: true })
      const closeBtn = wrapper.find('.add-place-modal__close')
      await closeBtn.trigger('pointerdown', { pointerId: 1, clientY: 0 })
      await wrapper.find('.add-place-modal__header').trigger('pointermove', { pointerId: 1, clientY: 200 })
      // If onDragStart had incorrectly started a drag, dragY would now be
      // 200 and the section would carry a translate3d transform for it.
      expect(wrapper.find('.add-place-modal').attributes('style')).toBeUndefined()
    })

    it('emits close once a downward drag passes the distance threshold', async () => {
      const wrapper = mountModal({ sheet: true })
      await drag(wrapper, 150, 400)
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('emits close on a fast short flick that passes the velocity threshold', async () => {
      const wrapper = mountModal({ sheet: true })
      await drag(wrapper, 60, 50)
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('snaps back without closing when the drag is short and slow', async () => {
      const wrapper = mountModal({ sheet: true })
      await drag(wrapper, 40, 400)
      expect(wrapper.emitted('close')).toBeUndefined()
    })
  })
})
