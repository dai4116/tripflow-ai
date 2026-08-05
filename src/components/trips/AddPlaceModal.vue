<template>
  <div
    class="add-place-modal-overlay"
    :class="{ 'add-place-modal-overlay--sheet': sheet }"
    role="presentation"
    @click.self="close"
  >
    <section
      class="add-place-modal"
      :class="{ 'add-place-modal--sheet': sheet }"
      role="dialog"
      aria-modal="true"
      aria-label="新增地點"
      :style="dragStyle"
    >
      <header
        class="add-place-modal__header"
        @pointerdown="sheet && onDragStart($event)"
        @pointermove="onDragMove"
        @pointerup="onDragEnd"
        @pointercancel="onDragEnd"
      >
        <span v-if="sheet" class="add-place-modal__handle" aria-hidden="true" />
        <div>
          <h3>新增地點</h3>
          <p class="add-place-modal__subtitle">到{{ columnTitle }}</p>
        </div>
        <button type="button" class="add-place-modal__close" aria-label="關閉" @click="close">
          <AppIcon name="close" :size="13" />
        </button>
      </header>

      <div class="add-place-modal__section">
        <BaseInput v-model="search" icon="search" :placeholder="`搜尋${city}的地點...`" />
        <div class="add-place-modal__pills">
          <button
            v-for="category in SEARCH_CATEGORIES"
            :key="category"
            type="button"
            class="preference-chip"
            :class="{ 'preference-chip--selected': activeCategory === category }"
            :disabled="isLoading"
            @click="toggleCategory(category)"
          >
            {{ categoryLabels[category] }}
          </button>
        </div>
      </div>

      <div class="add-place-modal__suggestions">
        <p v-if="isUnfiltered" class="add-place-modal__empty">
          輸入地點名稱開始搜尋<br>或選一個分類看附近熱門地點
        </p>
        <p v-else-if="isLoading" class="add-place-modal__empty">搜尋中…</p>
        <p v-else-if="searchFailed" class="add-place-modal__empty">搜尋發生問題，請稍後再試。</p>
        <template v-else>
          <button
            v-for="result in results"
            :key="result.placeId"
            type="button"
            class="add-place-suggestion"
            :class="{ 'add-place-suggestion--pending': !isReady(result) }"
            :disabled="!isReady(result)"
            @click="pickResult(result)"
          >
            <span class="add-place-suggestion__media">
              <!-- No loading="lazy": the row itself stays invisible via
                   add-place-suggestion--pending until this loads (or times
                   out), so deferring the fetch would just make the row
                   wait on a fetch that hasn't even started yet. -->
              <img
                v-if="showPhoto(result)"
                :class="{ 'add-place-suggestion__photo--loaded': isPhotoLoaded(result) }"
                :src="photoUrl(result)"
                alt=""
                @load="onPhotoLoad(result.placeId)"
                @error="onPhotoError(result.placeId)"
              />
              <AppIcon v-else name="image" :size="16" />
            </span>
            <span class="add-place-suggestion__body">
              <strong>{{ result.name }}</strong>
            </span>
            <AppIcon name="plus" :size="14" />
          </button>

          <p v-if="hasSearched && results.length === 0" class="add-place-modal__empty">
            沒有符合的地點，換個關鍵字或分類試試。
          </p>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { searchPlaces, type GeoPoint, type PlaceSearchResult } from '../../data/placesSearchClient'
import type { PlaceCategory } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseInput from '../ui/BaseInput.vue'
import {
  addedPlaceIdsFor,
  categoryCacheKey,
  categoryResultsCache,
  cityCenterByDestination,
  sameAnchor,
} from './addPlaceModalCache'
import { categoryLabels } from './CategoryChip.vue'

const props = defineProps<{
  columnId: string
  columnTitle: string
  city: string
  // Full trip destination (e.g. "京都，日本"), not just `city` — biases the
  // Google Places search to the right city (see geocodeCityCenter in
  // api/_lib/placesVerify.ts), which a bare city name can't disambiguate as
  // reliably for common place names.
  destination: string
  // Centroid of this column's already-added places (with real coordinates),
  // computed by TripBoardPage.vue — null for an empty/unpinned day, in which
  // case the search falls back to biasing around the whole destination city.
  dayAnchor: GeoPoint | null
  // Set by TripBoardPage.vue for isMobile. Drives both the `--sheet`
  // modifier classes below (mobile full takeover vs. desktop centered
  // dialog) and whether the swipe-down-to-close gesture is wired up (it only
  // makes sense on the bottom sheet, not a desktop panel).
  sheet?: boolean
}>()

const emit = defineEmits<{
  close: []
  add: [
    payload: {
      columnId: string
      name: string
      category: PlaceCategory
      description: string
      lat?: number
      lng?: number
      photoRef?: string
      placeId?: string
    },
  ]
}>()

// Narrower than the full PlaceCategory taxonomy: 'transport' isn't something
// a user searches Google Places for (it's a flight/booking detail typed in by
// hand). No 'other' chip either — see pickResult below, which falls back to
// Google's own inferred category (or finally 'other') for anything found
// with no chip selected.
const SEARCH_CATEGORIES: PlaceCategory[] = ['food', 'attraction', 'shopping', 'stay']

const search = ref('')
// null = no chip selected — an unfiltered typed search (there's no separate
// "all" chip for this; toggleCategory below just lets any chip be clicked
// back off to this same state) and, with an empty search box too, nothing to
// search for at all (see the template's empty-state message).
const activeCategory = ref<PlaceCategory | null>(null)

function toggleCategory(category: PlaceCategory) {
  activeCategory.value = activeCategory.value === category ? null : category
}

// Nothing typed and no chip selected — the fully-unfiltered empty state,
// nothing to search for. Shared by the template's empty-state message and
// runSearch's early-return guard so the two can't drift out of sync.
const isUnfiltered = computed(() => !search.value.trim() && !activeCategory.value)

const results = ref<PlaceSearchResult[]>([])
const isLoading = ref(false)
const hasSearched = ref(false)
const searchFailed = ref(false)
const failedPhotoIds = ref(new Set<string>())

// See addPlaceModalCache.ts for why this lives in its own module instead of
// here — a `const` at this scope re-initializes every time the modal
// reopens, which defeats the whole point of caching across reopens.
const addedPlaceIds = addedPlaceIdsFor(props.columnId)

function photoUrl(result: PlaceSearchResult): string {
  return `/api/place-photo?ref=${encodeURIComponent(result.photoRef ?? '')}&w=96`
}

function showPhoto(result: PlaceSearchResult): boolean {
  return Boolean(result.photoRef) && !failedPhotoIds.value.has(result.placeId)
}

// Mirrors usePlacePhoto's ready/timeout behavior (see usePlacePhoto.ts) but
// tracked per-row here instead, since search results are PlaceSearchResult —
// not the Place type that composable works with — and each row needs its own
// independent ready state rather than one shared card's.
const LOAD_TIMEOUT_MS = 500
const loadedPhotoIds = ref(new Set<string>())
const timedOutPhotoIds = ref(new Set<string>())
const loadTimeouts = new Map<string, number>()

function isPhotoLoaded(result: PlaceSearchResult): boolean {
  return loadedPhotoIds.value.has(result.placeId)
}

function isReady(result: PlaceSearchResult): boolean {
  return (
    !showPhoto(result) || loadedPhotoIds.value.has(result.placeId) || timedOutPhotoIds.value.has(result.placeId)
  )
}

function onPhotoLoad(placeId: string) {
  loadedPhotoIds.value.add(placeId)
  window.clearTimeout(loadTimeouts.get(placeId))
  loadTimeouts.delete(placeId)
}

function onPhotoError(placeId: string) {
  failedPhotoIds.value.add(placeId)
  window.clearTimeout(loadTimeouts.get(placeId))
  loadTimeouts.delete(placeId)
}

// New results (a fresh search, or a browse cache hit) each get their own
// load-timeout clock started here — the template can't do this itself since
// there's no per-row mounted hook without splitting each row into its own
// component, which isn't worth it just for this.
watch(results, (newResults) => {
  for (const result of newResults) {
    if (!result.photoRef) continue
    if (loadedPhotoIds.value.has(result.placeId) || timedOutPhotoIds.value.has(result.placeId)) continue
    if (loadTimeouts.has(result.placeId)) continue
    loadTimeouts.set(
      result.placeId,
      window.setTimeout(() => {
        timedOutPhotoIds.value.add(result.placeId)
        loadTimeouts.delete(result.placeId)
      }, LOAD_TIMEOUT_MS),
    )
  }
})

// Debounced so every keystroke doesn't fire its own Google-backed request —
// only the last one after the user pauses does. The in-flight request is
// aborted (not just ignored) when a newer one supersedes it, so a slow
// earlier response can't land after a faster later one and show stale results.
const DEBOUNCE_MS = 400
let debounceTimer: number | undefined
let activeController: AbortController | null = null

async function runSearch() {
  const query = search.value.trim()
  const category = activeCategory.value
  // Snapshotted once, like `query`/`category` above — props.dayAnchor is
  // reactive and can change while this function is suspended at the `await`
  // below (the day's centroid shifts as places are added/moved). Reading
  // `props.dayAnchor` again after the await instead of reusing this would
  // cache the response under whatever anchor happens to be current when the
  // response lands, not the one it was actually fetched for.
  const dayAnchor = props.dayAnchor
  activeController?.abort()

  // A chip alone (no query) still searches: the server browses nearby via
  // nearbyPlaces instead of Text Search — see api/places-search.ts.
  if (isUnfiltered.value) {
    results.value = []
    isLoading.value = false
    hasSearched.value = false
    searchFailed.value = false
    return
  }

  const isBrowse = !query && category !== null
  if (isBrowse) {
    const cached = categoryResultsCache.get(categoryCacheKey(props.columnId, category))
    if (cached && sameAnchor(cached.dayAnchor, dayAnchor)) {
      isLoading.value = false
      hasSearched.value = true
      searchFailed.value = false
      results.value = cached.results.filter((result) => !addedPlaceIds.has(result.placeId))
      return
    }
  }

  const controller = new AbortController()
  activeController = controller
  searchFailed.value = false

  const response = await searchPlaces(
    query,
    category ?? undefined,
    props.destination,
    dayAnchor,
    cityCenterByDestination.get(props.destination),
    controller.signal,
  )
  if (controller.signal.aborted) return

  isLoading.value = false
  hasSearched.value = true
  if (response === undefined) {
    searchFailed.value = true
    results.value = []
    return
  }
  if (!cityCenterByDestination.has(props.destination) && response.cityCenter) {
    cityCenterByDestination.set(props.destination, response.cityCenter)
  }
  if (isBrowse) {
    categoryResultsCache.set(categoryCacheKey(props.columnId, category), {
      dayAnchor,
      results: response.results,
    })
  }
  results.value = response.results.filter((result) => !addedPlaceIds.has(result.placeId))
}

// Keystrokes debounce (avoid firing a request per character); a category
// chip click is a single discrete action with no repetition risk, so it
// re-searches immediately instead of waiting out the same delay. Both paths
// set `isLoading` synchronously here, not just inside `runSearch` once the
// request actually starts — without that, the PREVIOUS filter's results stay
// rendered and clickable for the ~400ms gap before the new search lands, and
// clicking one during that window would read the now-already-changed
// `activeCategory` and tag the place with the wrong category.
watch(search, () => {
  isLoading.value = true
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(runSearch, DEBOUNCE_MS)
})

// No debounce here (unlike the search watcher below) — a chip click should
// feel instant. The template's `:disabled="isLoading"` on the chips is what
// actually keeps this cheap: it can't fire a second billed Nearby/Text
// Search (or a second, redundant geocode before cityCenterByDestination
// resolves) until the current one finishes, since `isLoading` flips true
// synchronously here, before runSearch's own await.
watch(activeCategory, () => {
  isLoading.value = true
  window.clearTimeout(debounceTimer)
  runSearch()
})

onBeforeUnmount(() => {
  window.clearTimeout(debounceTimer)
  activeController?.abort()
  loadTimeouts.forEach((id) => window.clearTimeout(id))
})

function pickResult(result: PlaceSearchResult) {
  const chipCategory = activeCategory.value
  // `result.category` only ever holds a value GOOGLE_TYPE_TO_CATEGORY
  // (api/_lib/placesVerify.ts) produced, which is always a real PlaceCategory
  // — safe to trust as one here even though the wire type is a bare string.
  const inferredCategory = result.category as PlaceCategory | undefined
  emit('add', {
    columnId: props.columnId,
    name: result.name,
    // Trust the active chip when the user picked one; with no chip selected,
    // fall back to Google's own place-type-derived guess before finally
    // giving up and tagging it 'other'.
    category: chipCategory ?? inferredCategory ?? 'other',
    description: '',
    lat: result.lat,
    lng: result.lng,
    photoRef: result.photoRef,
    placeId: result.placeId,
  })
  addedPlaceIds.add(result.placeId)
  // Remove it from the visible list immediately — without this the button
  // stays rendered and clickable, and a second click (accidental double-click,
  // or a deliberate re-click since there's no other success feedback) adds
  // the exact same place a second time with a new id.
  results.value = results.value.filter((item) => item.placeId !== result.placeId)
}

function close() {
  emit('close')
}

// Swipe-down-to-close for the mobile sheet variant (props.sheet) — dragging
// the header follows the finger 1:1 via inline transform while active, then
// either closes (past distance/velocity threshold) or snaps back. Only the
// header is a drag surface, not the whole sheet: the suggestions list below
// needs its own vertical touch gestures for scrolling, and mixing the two
// would require reading scrollTop to disambiguate on every move.
const dragY = ref(0)
const isDragging = ref(false)
let dragPointerId: number | null = null
let dragStartY = 0
let dragStartTime = 0

const dragStyle = computed(() => {
  if (!isDragging.value && dragY.value === 0) return undefined
  return {
    transform: `translate3d(0, ${dragY.value}px, 0)`,
    transition: isDragging.value ? 'none' : 'transform 200ms ease',
  }
})

function onDragStart(event: PointerEvent) {
  isDragging.value = true
  dragPointerId = event.pointerId
  dragStartY = event.clientY
  // Date.now() rather than event.timeStamp: timeStamp is relative to an
  // unspecified time origin (typically navigation start, via
  // performance.now()), which is fine for a single event but awkward to
  // diff against fake timers in tests — Date.now() responds directly to
  // vi.useFakeTimers()/vi.advanceTimersByTime().
  dragStartTime = Date.now()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onDragMove(event: PointerEvent) {
  if (!isDragging.value || event.pointerId !== dragPointerId) return
  dragY.value = Math.max(0, event.clientY - dragStartY)
}

// Closes past either threshold so a fast short flick and a slow long drag
// both dismiss — relying on distance alone would miss quick flicks that
// haven't traveled far yet when the finger lifts.
const CLOSE_DISTANCE_PX = 120
const CLOSE_VELOCITY_PX_MS = 0.5

function onDragEnd(event: PointerEvent) {
  if (!isDragging.value || event.pointerId !== dragPointerId) return
  isDragging.value = false
  dragPointerId = null
  const distance = dragY.value
  const velocity = distance / Math.max(Date.now() - dragStartTime, 1)
  dragY.value = 0
  if (distance > CLOSE_DISTANCE_PX || velocity > CLOSE_VELOCITY_PX_MS) {
    close()
  }
}
</script>
