// Bumped alongside the other tripflow-*-vN localStorage keys' convention
// (see stores/trips.ts) — not that this one has a schema to outgrow, just
// kept consistent so a future unrelated bump doesn't collide with it.
const ONBOARDING_SEEN_KEY = 'tripflow-onboarding-seen-v1'

export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1'
}

export function markOnboardingSeen(): void {
  localStorage.setItem(ONBOARDING_SEEN_KEY, '1')
}
