import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { Place } from '../types'

// Renders a place's real Google photo when one's on record, falling back to
// a generic placeholder otherwise — shared by PlaceCard's thumbnail and the
// trip/explore drawer banners (see place-drawer__image in TripBoardPage.vue /
// ExploreTripBoardPage.vue).
//
// widthPx should match the rendered size (2x for retina) of whichever slot
// is calling this — PlaceCard's 64px thumbnail and the drawer's ~500px
// banner need very different source resolutions; without this they'd both
// get /api/place-photo's default, leaving the banner visibly blurry.
//
// `ready` gates when the CALLER should reveal its whole card (photo + name
// etc.) together, instead of the name popping in immediately while the photo
// is still an async network fetch — it's true once there's nothing left to
// wait for (no photo, load succeeded, load failed) or LOAD_TIMEOUT_MS has
// passed on a slow photo (so a bad connection can't leave the card blank
// forever; the real photo still crossfades in via `photoLoaded` whenever it
// does land).
const LOAD_TIMEOUT_MS = 500

export function usePlacePhoto(place: Ref<Place | null | undefined>, widthPx: number) {
  const photoFailed = ref(false)
  const photoLoaded = ref(false)
  const timedOut = ref(false)
  let timeoutId: number | undefined

  // A drawer reuses one component instance across whichever place is
  // currently open (unlike PlaceCard, which gets a fresh instance per
  // place via v-for) — without this reset, one place's failed/loaded photo
  // would permanently affect every place opened afterward in the same drawer.
  watch(
    () => place.value?.id,
    () => {
      photoFailed.value = false
      photoLoaded.value = false
      timedOut.value = false
      window.clearTimeout(timeoutId)
      if (place.value?.photoRef) {
        timeoutId = window.setTimeout(() => {
          timedOut.value = true
        }, LOAD_TIMEOUT_MS)
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => window.clearTimeout(timeoutId))

  const showPhoto = computed(() => Boolean(place.value?.photoRef) && !photoFailed.value)
  const photoUrl = computed(
    () => `/api/place-photo?ref=${encodeURIComponent(place.value?.photoRef ?? '')}&w=${widthPx}`,
  )
  const ready = computed(() => !showPhoto.value || photoLoaded.value || timedOut.value)

  function onPhotoLoad() {
    photoLoaded.value = true
  }

  // A photoRef can be missing (no photo on record) or, rarely, stale
  // (Google doesn't guarantee the resource name forever) — either way
  // /api/place-photo answers 404, and this flips back to the placeholder the
  // same as if photoRef had never been set.
  function onPhotoError() {
    photoFailed.value = true
  }

  return { showPhoto, photoUrl, photoLoaded, ready, onPhotoLoad, onPhotoError }
}
