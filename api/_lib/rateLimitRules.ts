import type { RateLimitRule } from './rateLimit.js'

// Single source of truth for each endpoint's own rate-limit rule — imported
// both by the endpoint's own handler (to enforce it) and by
// api/admin/usage.ts (to read `endpoint`/`globalPerDay` for the dashboard)
// without pulling that handler's whole module graph (Anthropic SDK client
// setup, tripGen.ts, placesVerify.ts, etc.) into the admin function's
// bundle just to read one small constant.

// One call per CITY GROUP, not one per trip — a multi-destination trip
// (CreateTripPage.vue's MAX_CITIES = 8) can fire up to 8 of these for a
// single, entirely legitimate "create trip" click. sessionPer10Min/
// sessionPerDay are sized to comfortably clear that in one shot (confirmed
// live: the original 3/10min, 8/day pair self-rate-limited a normal 4+-city
// trip on its very first attempt, before any abuse was possible) rather than
// being tuned around "one attempt = one call".
export const PLAN_TRIP_ZONES_RULE: RateLimitRule = {
  endpoint: 'plan-trip-zones',
  sessionPer10Min: 10,
  sessionPerDay: 20,
  globalPerDay: 60,
}

// This is the endpoint that actually does the expensive work (Claude
// generation + Google Places verification for a whole day), reachable
// directly by any caller that skips plan-trip-zones.ts entirely — its own
// per-visitor/per-day limits mean nothing if this endpoint has no backstop of
// its own. Deliberately global-only, no sessionPer10Min/sessionPerDay: a
// legitimate multi-day trip fires one call per day in parallel (see
// aiTripClient.ts's MAX_PARALLEL_REQUESTS), and a per-visitor cap here would
// risk blocking some days of an already-approved trip but not others — a
// worse failure mode than the fairness gap it would close. globalPerDay is
// sized as a generous site-wide ceiling purely to bound worst-case cost from
// a direct-bypass abuser, not to constrain normal usage.
export const GENERATE_TRIP_DAY_RULE: RateLimitRule = {
  endpoint: 'generate-trip-day',
  globalPerDay: 200,
}

export const ASK_AI_RULE: RateLimitRule = {
  endpoint: 'ask-ai',
  sessionPer10Min: 5,
  sessionPerDay: 15,
  globalPerDay: 100,
}
