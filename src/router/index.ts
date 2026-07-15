import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

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
