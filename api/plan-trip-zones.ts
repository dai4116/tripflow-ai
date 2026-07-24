import Anthropic from '@anthropic-ai/sdk'
import {
  buildZonePlanPrompt,
  validateDestination,
  validateTotalDays,
  ZONE_SCHEMA,
  type TripContext,
  type VercelLikeRequest,
  type VercelLikeResponse,
  type ZoneHint,
} from './_lib/tripGen.js'
import { geocodeCityCenter, type GeoPoint } from './_lib/placesVerify.js'

// Stage 1 of trip generation, split out into its own lightweight request so
// the client can call it once up front, then fan out many small per-day
// requests to generate-trip-day.ts (see aiTripClient.ts) instead of one
// server-side function looping through the whole trip. This call is cheap —
// short zone/theme labels for every day, not full place details — so 20s is
// generous headroom, nowhere near Vercel's 60s Hobby-tier ceiling.
export const config = { maxDuration: 20 }

type PlanZonesBody = TripContext & { totalDays?: number }

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { destination, travelStyle, preferences, additionalNotes, totalDays } = (req.body ?? {}) as PlanZonesBody
  if (!validateDestination(destination)) {
    res.status(400).json({ error: 'Missing destination' })
    return
  }
  if (!validateTotalDays(totalDays)) {
    res.status(400).json({ error: 'Invalid totalDays' })
    return
  }

  const ctx: TripContext = { destination, travelStyle, preferences, additionalNotes }
  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  // Best-effort on both halves — this endpoint exists purely to make later
  // per-day requests better (theme coherence + one shared city center
  // instead of N redundant geocodes), never to gate them. A missing key or a
  // failed call just means the per-day requests fall back to their own
  // per-request behavior, same as before this endpoint existed. Both share
  // controller.signal so a client disconnect cancels the in-flight Claude
  // AND Google calls, not just whichever one the signal happened to reach.
  const [zones, cityCenter] = await Promise.all([
    planZones(ctx, totalDays, controller.signal),
    resolveCityCenter(destination, controller.signal),
  ])

  res.status(200).json({ zones, cityCenter })
}

async function planZones(ctx: TripContext, totalDays: number, signal: AbortSignal): Promise<ZoneHint[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []

  try {
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream(
      {
        model: 'claude-sonnet-5',
        // Output here is only ~totalDays short labels, nowhere near this
        // ceiling — sized generously anyway since going over would force an
        // early cutoff mid-JSON with no partial-result fallback.
        max_tokens: 4000,
        thinking: { type: 'disabled' },
        output_config: { format: { type: 'json_schema', schema: ZONE_SCHEMA } },
        messages: [{ role: 'user', content: buildZonePlanPrompt(ctx, totalDays) }],
      },
      { signal },
    )
    const response = await stream.finalMessage()
    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return []
    const parsed = JSON.parse(textBlock.text) as { days?: ZoneHint[] }
    return (parsed.days ?? []).filter(
      (entry) => Number.isInteger(entry.day) && entry.day >= 1 && entry.day <= totalDays,
    )
  } catch (error) {
    console.error('[plan-trip-zones] zone planning failed, returning no hints', error)
    return []
  }
}

async function resolveCityCenter(destination: string, signal: AbortSignal): Promise<GeoPoint | null> {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY
  if (!googleKey) return null
  return geocodeCityCenter(googleKey, destination, signal)
}
