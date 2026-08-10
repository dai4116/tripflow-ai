import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as placesAutocompleteClient from '../../data/placesAutocompleteClient'
import type { DestinationSuggestion, ResolvedDestination } from '../../data/placesAutocompleteClient'
import DestinationAutocomplete from './DestinationAutocomplete.vue'

// A tiny real v-model host, since the component reads props.modelValue itself
// (in runSearch) rather than only working off the raw DOM input value — a
// bare `mount(DestinationAutocomplete, { props: {...} })` with no reactive
// binding would leave modelValue stale once the debounced search actually
// fires.
function mountHost(initialValue = '') {
  const selectEvents: (({ placeId: string; lat: number; lng: number } | null))[] = []
  const host = defineComponent({
    setup() {
      const value = ref(initialValue)
      return () =>
        h(DestinationAutocomplete, {
          modelValue: value.value,
          'onUpdate:modelValue': (v: string) => {
            value.value = v
          },
          onSelect: (payload: { placeId: string; lat: number; lng: number } | null) => {
            selectEvents.push(payload)
          },
        })
    },
  })
  const wrapper = mount(host)
  return { wrapper, selectEvents }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DestinationAutocomplete', () => {
  it('debounces the search — rapid typing fires autocompleteDestination only once, with the final value', async () => {
    const spy = vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([])
    const { wrapper } = mountHost('')

    await wrapper.find('input').setValue('東')
    await wrapper.find('input').setValue('東京')
    expect(spy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(400)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toBe('東京')
  })

  it('shows a loading indicator only when a search takes longer than 200ms', async () => {
    let resolveSearch!: (suggestions: DestinationSuggestion[] | undefined) => void
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockImplementation(
      () => new Promise((resolve) => {
        resolveSearch = resolve
      }),
    )
    const { wrapper } = mountHost('')

    await wrapper.find('input').setValue('東京')
    await vi.advanceTimersByTimeAsync(199)
    expect(wrapper.find('.destination-autocomplete__loading').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.find('.destination-autocomplete__loading').exists()).toBe(true)

    resolveSearch([{ placeId: 'pA', mainText: '東京', secondaryText: '日本' }])
    await flushPromises()
    expect(wrapper.find('.destination-autocomplete__loading').exists()).toBe(false)
  })

  it('picking a suggestion composes the label, clears any prior selection immediately, then resolves coordinates', async () => {
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([{ placeId: 'pA', mainText: '東京', secondaryText: '日本' }])
    vi.spyOn(placesAutocompleteClient, 'resolveDestinationPlace').mockResolvedValue({ lat: 35, lng: 139 })
    const { wrapper, selectEvents } = mountHost('')

    await wrapper.find('input').setValue('東京')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    await wrapper.find('.destination-autocomplete__option').trigger('mousedown')
    await flushPromises()

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('東京，日本')
    expect(selectEvents).toEqual([null, { placeId: 'pA', lat: 35, lng: 139 }])
  })

  it('discards a stale Details resolution once a newer edit + pick has already superseded it', async () => {
    const resolveCalls: { placeId: string; resolve: (v: ResolvedDestination) => void }[] = []
    vi.spyOn(placesAutocompleteClient, 'resolveDestinationPlace').mockImplementation(
      (placeId: string) => new Promise((resolve) => resolveCalls.push({ placeId, resolve })),
    )
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockImplementation(async (input: string) => {
      if (input === '東京') return [{ placeId: 'pA', mainText: '東京', secondaryText: '' }]
      if (input === '大阪') return [{ placeId: 'pB', mainText: '大阪', secondaryText: '' }]
      return []
    })
    const { wrapper, selectEvents } = mountHost('')

    await wrapper.find('input').setValue('東京')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    await wrapper.find('.destination-autocomplete__option').trigger('mousedown') // picks A — resolveDestinationPlace('pA') now pending
    await flushPromises()

    // Edits past the pick (invalidates it), then picks a different place.
    await wrapper.find('input').setValue('大阪')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    await wrapper.find('.destination-autocomplete__option').trigger('mousedown') // picks B — resolveDestinationPlace('pB') now pending
    await flushPromises()

    // B resolves first; A's (now-stale) resolution lands after.
    resolveCalls[1]!.resolve({ lat: 34, lng: 135 })
    await flushPromises()
    resolveCalls[0]!.resolve({ lat: 35, lng: 139 })
    await flushPromises()

    const realSelections = selectEvents.filter((e) => e !== null)
    expect(realSelections).toEqual([{ placeId: 'pB', lat: 34, lng: 135 }])
  })

  it('editing the field after a resolved selection clears it', async () => {
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([{ placeId: 'pA', mainText: '東京', secondaryText: '日本' }])
    vi.spyOn(placesAutocompleteClient, 'resolveDestinationPlace').mockResolvedValue({ lat: 35, lng: 139 })
    const { wrapper, selectEvents } = mountHost('')

    await wrapper.find('input').setValue('東京')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    await wrapper.find('.destination-autocomplete__option').trigger('mousedown')
    await flushPromises()
    expect(selectEvents.at(-1)).toEqual({ placeId: 'pA', lat: 35, lng: 139 })

    await wrapper.find('input').setValue('東京，日本 extra')
    expect(selectEvents.at(-1)).toEqual(null)
  })

  it('Enter selects the sole open suggestion even with nothing highlighted', async () => {
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([{ placeId: 'pA', mainText: '東京', secondaryText: '' }])
    vi.spyOn(placesAutocompleteClient, 'resolveDestinationPlace').mockResolvedValue({ lat: 35, lng: 139 })
    const { wrapper, selectEvents } = mountHost('')

    await wrapper.find('input').setValue('東京')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(selectEvents.some((e) => e?.placeId === 'pA')).toBe(true)
  })

  it('ArrowDown moves the highlight, and Enter selects the highlighted (not just the first) suggestion', async () => {
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([
      { placeId: 'pA', mainText: '東京', secondaryText: '' },
      { placeId: 'pB', mainText: '大阪', secondaryText: '' },
    ])
    vi.spyOn(placesAutocompleteClient, 'resolveDestinationPlace').mockResolvedValue({ lat: 34, lng: 135 })
    const { wrapper, selectEvents } = mountHost('')

    await wrapper.find('input').setValue('日本')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(selectEvents.some((e) => e?.placeId === 'pB')).toBe(true)
  })

  it('resolvePending flushes a still-debouncing search and auto-selects a sole match', async () => {
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([{ placeId: 'pA', mainText: '東京', secondaryText: '日本' }])
    vi.spyOn(placesAutocompleteClient, 'resolveDestinationPlace').mockResolvedValue({ lat: 35, lng: 139 })
    const { wrapper, selectEvents } = mountHost('')

    await wrapper.find('input').setValue('東京') // debounce still pending — no timer advance, simulating Enter right after typing
    const resolved = await wrapper.findComponent(DestinationAutocomplete).vm.resolvePending()

    expect(resolved).toBe(true)
    expect(selectEvents.at(-1)).toEqual({ placeId: 'pA', lat: 35, lng: 139 })
  })

  it('resolvePending opens the dropdown and blocks submit when multiple matches come back', async () => {
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([
      { placeId: 'pA', mainText: '東京', secondaryText: '日本' },
      { placeId: 'pB', mainText: '東京都', secondaryText: '日本' },
    ])
    const { wrapper, selectEvents } = mountHost('')

    await wrapper.find('input').setValue('東京')
    const resolved = await wrapper.findComponent(DestinationAutocomplete).vm.resolvePending()

    expect(resolved).toBe(false)
    expect(wrapper.find('.destination-autocomplete__suggestions').exists()).toBe(true)
    expect(selectEvents).toEqual([]) // nothing auto-picked — left for the user to confirm
  })

  it('resolvePending is a no-op when the text already matches a resolved selection', async () => {
    const spy = vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([
      { placeId: 'pA', mainText: '東京', secondaryText: '日本' },
    ])
    vi.spyOn(placesAutocompleteClient, 'resolveDestinationPlace').mockResolvedValue({ lat: 35, lng: 139 })
    const { wrapper } = mountHost('')

    await wrapper.find('input').setValue('東京')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    await wrapper.find('.destination-autocomplete__option').trigger('mousedown')
    await flushPromises()
    spy.mockClear()

    const resolved = await wrapper.findComponent(DestinationAutocomplete).vm.resolvePending()

    expect(resolved).toBe(true)
    expect(spy).not.toHaveBeenCalled() // already resolved — no redundant search
  })

  it('resolvePending falls back to free text when the search comes back empty', async () => {
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([])
    const { wrapper, selectEvents } = mountHost('')

    await wrapper.find('input').setValue('一個不存在的地方')
    const resolved = await wrapper.findComponent(DestinationAutocomplete).vm.resolvePending()

    expect(resolved).toBe(true)
    expect(selectEvents).toEqual([]) // never resolved a place — caller submits the typed text as-is
  })

  it('Escape closes an open dropdown', async () => {
    vi.spyOn(placesAutocompleteClient, 'autocompleteDestination').mockResolvedValue([{ placeId: 'pA', mainText: '東京', secondaryText: '' }])
    const { wrapper } = mountHost('')

    await wrapper.find('input').setValue('東京')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    expect(wrapper.find('.destination-autocomplete__suggestions').exists()).toBe(true)

    await wrapper.find('input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.destination-autocomplete__suggestions').exists()).toBe(false)
  })
})
