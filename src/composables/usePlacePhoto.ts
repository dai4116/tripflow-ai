import { computed, ref, watch, type Ref } from 'vue'
import type { Place } from '../types'

// Renders a place's real Google photo when one's on record, falling back to
// its decorative imageGradient otherwise — shared by PlaceCard's thumbnail
// and the trip/explore drawer banners (see place-drawer__image in
// TripBoardPage.vue / ExploreTripBoardPage.vue).
//
// widthPx should match the rendered size (2x for retina) of whichever slot
// is calling this — PlaceCard's 64px thumbnail and the drawer's ~500px
// banner need very different source resolutions; without this they'd both
// get /api/place-photo's default, leaving the banner visibly blurry.
export function usePlacePhoto(place: Ref<Place | null | undefined>, widthPx: number) {
  const photoFailed = ref(false)

  // A drawer reuses one component instance across whichever place is
  // currently open (unlike PlaceCard, which gets a fresh instance per
  // place via v-for) — without this reset, one place's failed photo would
  // permanently blank out every place opened afterward in the same drawer.
  watch(
    () => place.value?.id,
    () => {
      photoFailed.value = false
    },
  )

  const showPhoto = computed(() => Boolean(place.value?.photoRef) && !photoFailed.value)
  const photoUrl = computed(
    () => `/api/place-photo?ref=${encodeURIComponent(place.value?.photoRef ?? '')}&w=${widthPx}`,
  )

  // A photoRef can be missing (no photo on record) or, rarely, stale
  // (Google doesn't guarantee the resource name forever) — either way
  // /api/place-photo answers 404, and this flips back to the gradient the
  // same as if photoRef had never been set.
  function onPhotoError() {
    photoFailed.value = true
  }

  return { showPhoto, photoUrl, onPhotoError }
}
