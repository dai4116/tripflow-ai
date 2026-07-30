<template>
  <Teleport to="body">
    <div class="add-place-modal-overlay" role="presentation" @click.self="close">
      <section class="add-place-modal" role="dialog" aria-modal="true" aria-label="新增地點">
        <header class="add-place-modal__header">
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
              @click="toggleCategory(category)"
            >
              {{ categoryLabels[category] }}
            </button>
          </div>
        </div>

        <div class="add-place-modal__suggestions">
          <p v-if="isUnfiltered" class="add-place-modal__empty">
            輸入地點名稱開始搜尋，或選一個分類看附近熱門地點。
          </p>
          <p v-else-if="isLoading" class="add-place-modal__empty">搜尋中…</p>
          <p v-else-if="searchFailed" class="add-place-modal__empty">搜尋發生問題，請稍後再試。</p>
          <template v-else>
            <button
              v-for="result in results"
              :key="result.placeId"
              type="button"
              class="add-place-suggestion"
              @click="pickResult(result)"
            >
              <span class="add-place-suggestion__media">
                <img
                  v-if="showPhoto(result)"
                  :src="photoUrl(result)"
                  alt=""
                  loading="lazy"
                  @error="onPhotoError(result.placeId)"
                />
                <AppIcon v-else :name="fallbackIcon" :size="16" />
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
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { searchPlaces, type GeoPoint, type PlaceSearchResult } from '../../data/placesSearchClient'
import type { PlaceCategory } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import BaseInput from '../ui/BaseInput.vue'
import { categoryIcons, categoryLabels } from './CategoryChip.vue'

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
// Tracks places added THIS modal session, by Google placeId (not name — a
// name-based check would also hide a different real place that just happens
// to share a name with something already in the trip, e.g. a second
// "7-ELEVEN" branch elsewhere in the city). Resets every time the modal
// re-opens (a fresh component instance), so it only prevents re-adding the
// exact same place within one search session, not across the whole trip.
const addedPlaceIds = ref(new Set<string>())

const fallbackIcon = computed(() => {
  const category = activeCategory.value
  return category ? categoryIcons[category] : 'pin'
})

function photoUrl(result: PlaceSearchResult): string {
  return `/api/place-photo?ref=${encodeURIComponent(result.photoRef ?? '')}&w=96`
}

function showPhoto(result: PlaceSearchResult): boolean {
  return Boolean(result.photoRef) && !failedPhotoIds.value.has(result.placeId)
}

function onPhotoError(placeId: string) {
  failedPhotoIds.value.add(placeId)
}

// Resolved once per modal session and reused on every later search — stays
// `undefined` ("not resolved yet") until a search actually returns a real
// GeoPoint. A `null` response (destination geocoding failed — often
// transient: a rate limit, a timeout) is deliberately NOT cached here: it's
// the same as leaving this `undefined`, so the NEXT search retries the
// geocode server-side instead of the whole session being stuck with no
// cityCenter (confirmed live: caching the null outright disabled the
// distance-guard/nearby-browse safety nets for the rest of the session with
// no way to recover short of closing and reopening the modal).
let cachedCityCenter: GeoPoint | undefined

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

  const controller = new AbortController()
  activeController = controller
  searchFailed.value = false

  const response = await searchPlaces(
    query,
    category ?? undefined,
    props.destination,
    props.dayAnchor,
    cachedCityCenter,
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
  if (cachedCityCenter === undefined && response.cityCenter) cachedCityCenter = response.cityCenter
  results.value = response.results.filter((result) => !addedPlaceIds.value.has(result.placeId))
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

watch(activeCategory, () => {
  isLoading.value = true
  window.clearTimeout(debounceTimer)
  runSearch()
})

onBeforeUnmount(() => {
  window.clearTimeout(debounceTimer)
  activeController?.abort()
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
  addedPlaceIds.value.add(result.placeId)
  // Remove it from the visible list immediately — without this the button
  // stays rendered and clickable, and a second click (accidental double-click,
  // or a deliberate re-click since there's no other success feedback) adds
  // the exact same place a second time with a new id.
  results.value = results.value.filter((item) => item.placeId !== result.placeId)
}

function close() {
  emit('close')
}
</script>
