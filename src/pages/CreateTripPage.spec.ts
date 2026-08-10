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

    expect(wrapper.text()).toContain('請輸入你想去哪裡')
    expect(wrapper.find('form').exists()).toBe(true) // still on the form, not generating
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('blocks submit and shows an error when the start date is blank', async () => {
    stubFetch()
    const { wrapper } = await mountPage()

    await wrapper.find('input[role="combobox"]').setValue('京都，日本')
    await wrapper.find('input[type="date"]').setValue('')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.text()).toContain('請選擇出發日期')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('adding a city adds a day stepper and grows the total day count; removing the added city restores the single-city state', async () => {
    stubFetch()
    const { wrapper } = await mountPage()

    await wrapper.get('input[role="combobox"]').setValue('京都，日本')
    expect(wrapper.findAll('input[role="combobox"]')).toHaveLength(1)
    expect(wrapper.find('.destination-list__remove').exists()).toBe(false) // sole city — nothing to remove down to
    const initialTotal = wrapper.get('.form-card__hint--live').text()

    await wrapper.get('.destination-list__add').trigger('click')
    expect(wrapper.findAll('input[role="combobox"]')).toHaveLength(2)
    expect(wrapper.findAll('.destination-list__remove')).toHaveLength(2) // now removable, both rows

    const secondCityDayButton = wrapper.findAll('button[aria-label="增加天數"]')[1]!
    await secondCityDayButton.trigger('click')
    expect(wrapper.get('.form-card__hint--live').text()).not.toBe(initialTotal) // total grew by the new city's days

    // Removes the SECOND (newly-added) row specifically, not just "a" remove
    // button — with both rows' day counts coincidentally equal, a wrong-index
    // removal could pass a day-count-only assertion for the wrong reason.
    await wrapper.findAll('.destination-list__remove')[1]!.trigger('click')
    expect(wrapper.findAll('input[role="combobox"]')).toHaveLength(1)
    expect((wrapper.get('input[role="combobox"]').element as HTMLInputElement).value).toBe('京都，日本')
    expect(wrapper.find('.destination-list__remove').exists()).toBe(false)
    expect(wrapper.get('.form-card__hint--live').text()).toBe(initialTotal)
  })

  it('removing a city before the one with a validation error keeps the error attached to the right (still-blank) field', async () => {
    stubFetch()
    const { wrapper } = await mountPage()

    // Three cities: the first two get a destination, the third stays blank
    // so it's the one that ends up holding the error.
    await wrapper.get('.destination-list__add').trigger('click')
    await wrapper.get('.destination-list__add').trigger('click')
    const comboboxes = () => wrapper.findAll('input[role="combobox"]')
    await comboboxes()[0]!.setValue('京都，日本')
    await comboboxes()[1]!.setValue('大阪，日本')

    await wrapper.get('form').trigger('submit')
    const errorRowIndex = () => wrapper.findAll('.destination-list__row').findIndex((row) => row.find('.base-field--error').exists())
    expect(errorRowIndex()).toBe(2)

    // Removing the FIRST city shifts every later row's position down by
    // one — the error must follow the still-blank city to its new position,
    // not stay pinned to a now-stale index (which would either hide the
    // error entirely or misattribute it to whichever city now sits there).
    await wrapper.findAll('.destination-list__remove')[0]!.trigger('click')
    expect(wrapper.findAll('.base-field--error')).toHaveLength(1)
    expect(errorRowIndex()).toBe(1)
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

    // generateTrip is now async (it awaits the destination field's own
    // pending resolution — see resolvePending — before flipping into the
    // generating view), so there's no longer a synchronous moment right
    // after submit where the generating view is showing but createTrip()
    // hasn't been kicked off yet; go straight to the settled end state.
    await wrapper.find('form').trigger('submit')
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
