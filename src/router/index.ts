import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useTripsStore } from '../stores/trips'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'landing',
    component: () => import('../pages/LandingPage.vue'),
    meta: { layout: 'marketing' },
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
    meta: { layout: 'workspace' },
    // TripBoardPage.vue falls back to trips[0] when :tripId doesn't match any
    // real trip (e.g. the hardcoded 'tokyo-explorer' demo id) — a graceful
    // fallback as long as SOME trip exists. With zero trips (fresh visitor,
    // or a stale tab open from before a localStorage version bump wiped
    // incompatible data — see tripflow-trips-v4 in stores/trips.ts) that
    // fallback itself is undefined, and the page crashes trying to read
    // properties off it. Redirect before the component ever mounts instead of
    // guarding every property access in that file.
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

export default router
