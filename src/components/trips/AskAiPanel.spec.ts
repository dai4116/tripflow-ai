import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as askAiClient from '../../data/askAiClient'
import type { AskAiResult } from '../../data/askAiClient'
import { useTripsStore } from '../../stores/trips'
import type { Place, Trip } from '../../types'
import AskAiPanel from './AskAiPanel.vue'

class MemoryStorage {
  #store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.#store.has(key) ? this.#store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.#store.set(key, value)
  }
  removeItem(key: string): void {
    this.#store.delete(key)
  }
  clear(): void {
    this.#store.clear()
  }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function seedTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    title: '測試之旅',
    destination: '京都，日本',
    days: 2,
    travelers: 2,
    placeCount: 0,
    color: '#000',
    dateRange: '',
    preferences: [],
    pace: 'balanced',
    columns: [
      { id: 'day-1', title: '第1天', dayNumber: 1, placeIds: [] },
      { id: 'day-2', title: '第2天', dayNumber: 2, placeIds: [] },
    ],
    ...overrides,
  }
}

function seedPlace(overrides: Partial<Place> & { id: string; tripId: string; columnId: string }): Place {
  return {
    name: 'Place',
    category: 'attraction',
    estimatedTime: 1,
    address: '京都，日本',
    lat: 0,
    lng: 0,
    description: 'd',
    ...overrides,
  }
}

let currentWrapper: ReturnType<typeof mount> | undefined

function mountPanel(setup?: (store: ReturnType<typeof useTripsStore>) => void) {
  const pinia = createPinia()
  const wrapper = mount(AskAiPanel, { props: { tripId: 'trip-1' }, global: { plugins: [pinia] } })
  currentWrapper = wrapper
  const store = useTripsStore(pinia)
  setup?.(store)
  return { wrapper, store }
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useFakeTimers()
  // Belt-and-suspenders: fetchAskAiResult is mocked directly in most tests
  // below, but stub the underlying fetch too so nothing here can ever reach
  // a real socket, regardless of which code path ends up calling it.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
})

afterEach(() => {
  // A leftover mounted instance from a previous test can still hold pending
  // watchers/timers — without unmounting, one of those can fire later under
  // a subsequent test's fake-timer advancement and hit the REAL (unmocked)
  // fetchAskAiResult, causing a real network attempt during teardown.
  currentWrapper?.unmount()
  currentWrapper = undefined
  vi.useRealTimers()
})

async function waitForThinking() {
  await vi.advanceTimersByTimeAsync(600)
  await flushPromises()
}

describe('AskAiPanel', () => {
  it('opens via the launcher and closes via the header close button', async () => {
    const { wrapper } = mountPanel((store) => store.trips.push(seedTrip()))
    expect(wrapper.find('.ask-ai-panel').exists()).toBe(false)

    await wrapper.find('.ask-ai-launcher').trigger('click')
    expect(wrapper.find('.ask-ai-panel').exists()).toBe(true)

    await wrapper.find('.ask-ai-panel__close').trigger('click')
    expect(wrapper.find('.ask-ai-panel').exists()).toBe(false)
  })

  it('the 推薦附近景點 chip opens a day picker, and picking a day sends the composed message', async () => {
    vi.spyOn(askAiClient, 'fetchAskAiResult').mockResolvedValue({ type: 'text', text: '好的！' } satisfies AskAiResult)
    const { wrapper } = mountPanel((store) => store.trips.push(seedTrip()))
    await wrapper.find('.ask-ai-launcher').trigger('click')

    await wrapper.find('.ask-ai-suggestion').trigger('click') // '推薦附近景點' is the first chip
    const dayButtons = wrapper.findAll('.ask-ai-day-chip')
    expect(dayButtons).toHaveLength(2)

    await dayButtons[0]!.trigger('click')
    await waitForThinking()

    expect(wrapper.text()).toContain('推薦我第 1 天附近的景點')
    expect(wrapper.text()).toContain('好的！')
  })

  it('applying a suggest_places reply adds every suggested place to the store and emits applied', async () => {
    vi.spyOn(askAiClient, 'fetchAskAiResult').mockResolvedValue({
      type: 'suggest_places',
      columnId: 'day-1',
      places: [{ name: '清水寺', category: 'attraction', description: 'd' }],
    } satisfies AskAiResult)
    const { wrapper, store } = mountPanel((store) => store.trips.push(seedTrip()))
    await wrapper.find('.ask-ai-launcher').trigger('click')
    await wrapper.find('.ask-ai-suggestion').trigger('click')
    await wrapper.findAll('.ask-ai-day-chip')[0]!.trigger('click')
    await waitForThinking()

    const applyButton = wrapper.findAll('.ask-ai-message__action--primary').at(-1)!
    await applyButton.trigger('click')

    expect(store.places.some((p) => p.name === '清水寺' && p.columnId === 'day-1')).toBe(true)
    expect(wrapper.emitted('applied')).toEqual([['day-1']])
  })

  it('dismissing a suggestion marks it dismissed without touching the store', async () => {
    vi.spyOn(askAiClient, 'fetchAskAiResult').mockResolvedValue({
      type: 'suggest_places',
      columnId: 'day-1',
      places: [{ name: '清水寺', category: 'attraction', description: 'd' }],
    } satisfies AskAiResult)
    const { wrapper, store } = mountPanel((store) => store.trips.push(seedTrip()))
    await wrapper.find('.ask-ai-launcher').trigger('click')
    await wrapper.find('.ask-ai-suggestion').trigger('click')
    await wrapper.findAll('.ask-ai-day-chip')[0]!.trigger('click')
    await waitForThinking()

    const dismissButton = wrapper.findAll('.ask-ai-message__action--secondary').at(-1)!
    await dismissButton.trigger('click')

    expect(store.places.length).toBe(0)
    expect(wrapper.emitted('applied')).toBeUndefined()
    expect(wrapper.text()).toContain('已略過')
  })

  it('falls back to keyword matching when fetchAskAiResult resolves undefined, and applying moves the mentioned place', async () => {
    vi.spyOn(askAiClient, 'fetchAskAiResult').mockResolvedValue(undefined)
    const { wrapper, store } = mountPanel((store) => {
      store.trips.push(seedTrip())
      store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1', name: '清水寺' }))
    })
    await wrapper.find('.ask-ai-launcher').trigger('click')

    await wrapper.find('input[type="text"]').setValue('把清水寺搬到第 2 天')
    await wrapper.find('form.ask-ai-panel__input').trigger('submit')
    await waitForThinking()

    expect(wrapper.text()).toContain('要套用這個變更嗎')

    const applyButton = wrapper.findAll('.ask-ai-message__action--primary').at(-1)!
    await applyButton.trigger('click')

    expect(store.places.find((p) => p.id === 'p1')!.columnId).toBe('day-2')
  })

  it('依路線排序 proposes a reorder for an out-of-order day, and applying it reorders the column', async () => {
    const { wrapper, store } = mountPanel((store) => {
      store.trips.push(
        seedTrip({
          columns: [{ id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['far', 'start', 'near'] }],
        }),
      )
      store.places.push(
        // lat/lng exactly (0,0) means "not yet geocoded" elsewhere in this
        // app (see hasCoords in generateTrip.ts) — computeRouteOrder uses the
        // same convention, so `start` needs a tiny non-zero offset to count
        // as a real, positioned place instead of tripping the "insufficient
        // data" branch.
        seedPlace({ id: 'start', tripId: 'trip-1', columnId: 'day-1', name: 'Start', lat: 0, lng: 0.01 }),
        seedPlace({ id: 'far', tripId: 'trip-1', columnId: 'day-1', name: 'Far', lat: 0, lng: 10 }),
        seedPlace({ id: 'near', tripId: 'trip-1', columnId: 'day-1', name: 'Near', lat: 0, lng: 1 }),
      )
    })
    await wrapper.find('.ask-ai-launcher').trigger('click')

    const routeChip = wrapper.findAll('.ask-ai-suggestion').find((c) => c.text().includes('依路線排序'))!
    await routeChip.trigger('click')
    await wrapper.findAll('.ask-ai-day-chip')[0]!.trigger('click')
    await waitForThinking()

    expect(wrapper.text()).toContain('繞了一些路')

    const applyButton = wrapper.findAll('.ask-ai-message__action--primary').at(-1)!
    await applyButton.trigger('click')

    expect(store.getTripById('trip-1')!.columns[0]!.placeIds).toEqual(['far', 'near', 'start'])
  })
})
