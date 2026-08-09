import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import CreateTripPage from './CreateTripPage.vue'

const Stub = { template: '<div />' }

// Node's own ambient `localStorage` (flag-gated, non-functional in this
// environment — see the trips.ts store tests for the same finding) can win
// out over happy-dom's, so install a deterministic in-memory stand-in
// explicitly rather than trust whichever one ends up installed.
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

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: Stub },
      { path: '/trips/:tripId', name: 'trip-board', component: Stub },
      { path: '/new', name: 'create-trip', component: Stub },
    ],
  })
}

async function mountPage() {
  const router = makeRouter()
  router.push({ name: 'create-trip' })
  await router.isReady()
  const wrapper = mount(CreateTripPage, { global: { plugins: [createPinia(), router] } })
  return { wrapper, router }
}

function stubFetch(handler?: (url: string, init: RequestInit) => Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const href = String(url)
    if (handler) return handler(href, init as RequestInit)
    return new Response('', { status: 500 })
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CreateTripPage', () => {
  it('blocks submit and shows an error when the destination is blank', async () => {
    stubFetch()
    const { wrapper } = await mountPage()

    await wrapper.find('form').trigger('submit')

    expect(wrapper.text()).toContain('請先告訴我們你要去哪裡')
    expect(wrapper.find('form').exists()).toBe(true) // still on the form, not generating
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('blocks submit and shows an error when the end date is not after the start date', async () => {
    stubFetch()
    const { wrapper } = await mountPage()

    await wrapper.find('input[role="combobox"]').setValue('京都，日本')
    await wrapper.find('input[aria-label="開始日期"]').setValue('2024-03-10')
    await wrapper.find('input[aria-label="結束日期"]').setValue('2024-03-05')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.text()).toContain('結束日期必須晚於開始日期')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('behaves as single-select: picking a new style swaps it, clicking the selected one is a no-op', async () => {
    stubFetch()
    const { wrapper } = await mountPage()
    const pills = () => wrapper.findAll('.choice-pill')
    const byLabel = (label: string) => pills().find((p) => p.text().includes(label))!
    const selectedLabels = () => pills().filter((p) => p.classes().includes('choice-pill--selected')).map((p) => p.text())

    // '精準規劃' is selected by default.
    expect(byLabel('精準規劃').classes()).toContain('choice-pill--selected')
    expect(selectedLabels()).toHaveLength(1)

    await byLabel('自在慢旅').trigger('click') // picking a different style swaps the selection
    expect(byLabel('自在慢旅').classes()).toContain('choice-pill--selected')
    expect(byLabel('精準規劃').classes()).not.toContain('choice-pill--selected')
    expect(selectedLabels()).toHaveLength(1)

    await byLabel('自在慢旅').trigger('click') // clicking the already-selected pill is a no-op, never deselects to zero
    expect(byLabel('自在慢旅').classes()).toContain('choice-pill--selected')
    expect(selectedLabels()).toHaveLength(1)
  })

  it('toggles a preference chip on and off with no selection cap', async () => {
    stubFetch()
    const { wrapper } = await mountPage()
    // Not one of the pre-selected defaults, so the first click actually selects it.
    const chip = wrapper.findAll('.preference-chip').find((c) => c.text() === '人文古蹟')!

    await chip.trigger('click')
    expect(chip.classes()).toContain('preference-chip--selected')
    await chip.trigger('click')
    expect(chip.classes()).not.toContain('preference-chip--selected')
  })

  it('generates the trip and navigates to the new trip board on success', async () => {
    stubFetch((url, init) => {
      if (url.includes('plan-trip-zones')) return new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
      if (url.includes('generate-trip-day')) {
        const body = JSON.parse(init.body as string) as { day: number }
        return new Response(
          JSON.stringify({ places: [{ day: body.day, name: '清水寺', category: 'attraction', description: 'd', placeId: `g${body.day}`, lat: 35, lng: 135 }] }),
          { status: 200 },
        )
      }
      return new Response('', { status: 500 })
    })
    const { wrapper, router } = await mountPage()
    await wrapper.find('input[role="combobox"]').setValue('京都，日本')

    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.generating').exists()).toBe(true)
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('trip-board')
    expect(typeof router.currentRoute.value.params.tripId).toBe('string')
  })

  it('shows a retry UI on generation failure, and 返回修改 goes back to the form', async () => {
    stubFetch() // every endpoint 500s -> fetchAiPlaces resolves undefined -> createTrip throws
    const { wrapper } = await mountPage()
    await wrapper.find('input[role="combobox"]').setValue('京都，日本')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('行程生成失敗')
    await wrapper.find('button:not([type="submit"])').exists() // sanity: buttons rendered

    const backButton = wrapper.findAll('button').find((b) => b.text() === '返回修改')!
    await backButton.trigger('click')

    expect(wrapper.find('form').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('行程生成失敗')
  })
})
