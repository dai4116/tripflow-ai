import { computed, ref, watch, type Ref } from 'vue'

// Same reset-on-change/fail-tracking shape as useCoverPhotoUrl.ts, minus the
// /api/place-photo proxy URL construction — for a plain, already-resolved
// image URL (TripSummary.coverImage) instead of a Google Places photoRef.
// Kept as its own tiny composable rather than folded into useCoverPhotoUrl:
// that one's whole job is building the proxy URL, this one has nothing to
// build, just pass-through + failure tracking.
//
// The reset-on-change watch matters here for the same reason it does there:
// DashboardPage.vue's spotlight card can swap which trip it's showing
// (upcoming -> last, or one upcoming trip replaced by another via cross-tab
// sync) without the component remounting — without resetting on a url
// change, an old trip's failed coverImage would permanently pin the card to
// the fallback illustration even after it starts showing a different trip
// with a perfectly good coverImage.
export function useImageWithFallback(rawUrl: Ref<string | undefined>) {
  const failed = ref(false)

  watch(rawUrl, () => {
    failed.value = false
  })

  const url = computed(() => (rawUrl.value && !failed.value ? rawUrl.value : undefined))

  function onError() {
    failed.value = true
  }

  return { url, onError }
}
