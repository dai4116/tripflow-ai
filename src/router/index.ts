import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { hasSeenOnboarding } from '../data/onboarding'
import { useTripsStore } from '../stores/trips'

// First-visit gate for the routes that actually enter the app (not the
// marketing landing page itself, and not explore-trip — that one's meant to
// stay a frictionless, no-commitment demo, see exploreTrips.ts). Includes
// trip-board so a first-time visitor who opens a direct/shared trip link
// still sees onboarding instead of skipping straight past it.
const ONBOARDING_GATED_ROUTES = new Set(['dashboard', 'trip-create', 'trips', 'trip-board'])

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'landing',
    component: () => import('../pages/LandingPage.vue'),
    meta: { layout: 'bare' },
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('../pages/OnboardingPage.vue'),
    meta: { layout: 'bare' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../pages/DashboardPage.vue'),
    meta: { layout: 'workspace' },
  },
  {
    path: '/new-trip',
    name: 'trip-create',
    component: () => import('../pages/CreateTripPage.vue'),
    meta: { layout: 'workspace' },
  },
  {
    path: '/trips',
    name: 'trips',
    component: () => import('../pages/TripsPage.vue'),
    meta: { layout: 'workspace' },
  },
  {
    path: '/explore/:templateId',
    name: 'explore-trip',
    component: () => import('../pages/ExploreTripBoardPage.vue'),
    meta: { layout: 'workspace' },
  },
  {
    path: '/trips/:tripId',
    name: 'trip-board',
    component: () => import('../pages/TripBoardPage.vue'),
    // hideMobileTopBar: the board's own PageHeader already carries the trip
    // title/destination/date, so the generic branded top bar is pure
    // duplicate chrome here — dropping it reclaims 48px of vertical space on
    // mobile for the day columns and place cards, which matter more on this
    // page than on any other.
    meta: { layout: 'workspace', hideMobileTopBar: true },
    // TripBoardPage.vue falls back to trips[0] when :tripId doesn't match any
    // real trip (e.g. the hardcoded 'tokyo-explorer' demo id) — a graceful
    // fallback as long as SOME trip exists. With zero trips (fresh visitor,
    // or a stale tab open from before a localStorage version bump wiped
    // incompatible data — see the tripflow-trips-vN key in stores/trips.ts) that
    // fallback itself is undefined, and the page crashes trying to read
    // properties off it. Redirect before the component ever mounts instead of
    // guarding every property access in that file.
    beforeEnter: () => {
      const tripsStore = useTripsStore()
      if (tripsStore.trips.length === 0) return { name: 'dashboard' }
    },
  },
  {
    path: '/trips/:tripId/print',
    name: 'trip-print',
    component: () => import('../pages/TripPrintPage.vue'),
    meta: { layout: 'bare' },
    // Not in ONBOARDING_GATED_ROUTES on purpose — this read-only view is
    // meant to work as a frictionless direct link (same spirit as
    // explore-trip), which matters once it doubles as the base for a future
    // public share link.
    beforeEnter: () => {
      const tripsStore = useTripsStore()
      if (tripsStore.trips.length === 0) return { name: 'dashboard' }
    },
  },
  {
    path: '/trips/new',
    redirect: { name: 'trip-create' },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.beforeEach((to) => {
  if (!hasSeenOnboarding() && typeof to.name === 'string' && ONBOARDING_GATED_ROUTES.has(to.name)) {
    // Carries the originally-requested URL through so OnboardingPage.vue's
    // finish() can send the user on to wherever they actually meant to go
    // (a direct/shared link to trip-create or a specific trip) instead of
    // always dumping them on the dashboard.
    return { name: 'onboarding', query: { redirect: to.fullPath } }
  }
})

export default router
