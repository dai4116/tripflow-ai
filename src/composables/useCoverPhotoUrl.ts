import { computed, ref, watch, type Ref } from 'vue'

// Shared by TripCard.vue, DashboardPage.vue, and TripSettingsModal.vue — all
// three need "photoRef -> proxied /api/place-photo URL, falling back to
// undefined (the caller's decorative gradient) once it fails to load", but
// none of them want usePlacePhoto.ts's loaded/timeout crossfade gating (that
// composable is keyed to a Place's identity, not a bare photoRef).
//
// The `failed` flag resets whenever `photoRef` itself changes value — without
// this, a photo that failed once would permanently pin its consumer to the
// gradient fallback even after photoRef points at a different, working photo
// (e.g. the user picks a new cover photo, or another browser tab's edit
// syncs in via the trips store's cross-tab localStorage sync).
export function useCoverPhotoUrl(photoRef: Ref<string | undefined>, widthPx: number) {
  const failed = ref(false)

  watch(photoRef, () => {
    failed.value = false
  })

  const url = computed(() =>
    photoRef.value && !failed.value
      ? `/api/place-photo?ref=${encodeURIComponent(photoRef.value)}&w=${widthPx}`
      : undefined,
  )

  function onError() {
    failed.value = true
  }

  // Exposed for callers that assign photoRef to the SAME value it already
  // holds (e.g. re-picking the currently-selected photo to retry it after a
  // failed load) — a same-value assignment is a no-op to Vue's ref setter,
  // so the watch above never fires and `failed` would otherwise stay stuck.
  function reset() {
    failed.value = false
  }

  return { url, onError, reset }
}
