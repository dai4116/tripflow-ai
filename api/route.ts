// Give the upstream OpenRouteService call headroom over Vercel's 10s default
// (which equals aiTripClient-style client timeouts, leaving no margin) — a
// slow-but-successful route lookup shouldn't be killed by the platform
// before the client itself decides to give up. Mirrors generate-trip.ts.
export const config = { maxDuration: 30 }

// Loosely typed on purpose — see generate-trip.ts for why (avoids pulling in
// @vercel/node's type package just for this one small function).
type VercelLikeRequest = {
  method?: string
  body?: unknown
}
type VercelLikeResponse = {
  status: (code: number) => VercelLikeResponse
  json: (body: unknown) => void
}

// OpenRouteService profile names, keyed by the app's own travel modes.
// 'manual' has no route to look up — routing.ts never sends it here.
const ORS_PROFILE: Record<string, string> = {
  driving: 'driving-car',
  walking: 'foot-walking',
  cycling: 'cycling-regular',
}

type RouteBody = {
  mode?: string
  from?: { lat?: number; lng?: number }
  to?: { lat?: number; lng?: number }
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.OPENROUTESERVICE_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Routing not configured' })
    return
  }

  const { mode, from, to } = (req.body ?? {}) as RouteBody
  const profile = mode ? ORS_PROFILE[mode] : undefined
  if (!profile || !from || !to || typeof from.lat !== 'number' || typeof from.lng !== 'number' || typeof to.lat !== 'number' || typeof to.lng !== 'number') {
    res.status(400).json({ error: 'Missing or invalid mode/from/to' })
    return
  }

  try {
    const response = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      // ORS takes coordinates as [lng, lat] pairs (GeoJSON order), not [lat, lng].
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
    })

    if (!response.ok) {
      // ORS answers 404 specifically when no routable path exists between the
      // two points — a permanent negative the client can safely cache.
      // Everything else (429 rate-limit, 403 auth, 5xx) is transient and is
      // surfaced as 502 so the client retries later instead of caching it.
      res.status(response.status === 404 ? 404 : 502).json({ error: 'Routing request failed' })
      return
    }

    const data = (await response.json()) as { routes?: { summary?: { duration: number; distance: number } }[] }
    const summary = data.routes?.[0]?.summary
    if (!summary) {
      // 200 but no usable route in the payload — same permanent-negative
      // meaning as an upstream 404.
      res.status(404).json({ error: 'No route found' })
      return
    }

    res.status(200).json({ durationMin: Math.round(summary.duration / 60), distanceKm: summary.distance / 1000 })
  } catch (error) {
    console.error('route failed', error)
    res.status(502).json({ error: 'Routing request failed' })
  }
}
