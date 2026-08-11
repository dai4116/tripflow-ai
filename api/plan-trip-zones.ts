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

type PlanZonesBody = TripContext & {
  totalDays?: number
  // Group-relative day numbers (1-indexed against THIS call's own totalDays,
  // not the whole trip) that a flight actually narrows — see
  // buildZonePlanPrompt's own comment for why zone planning needs to know
  // this rather than leaving it to generate-trip-day.ts's later
  // flightConstraintLine alone. Sent only for the city group that actually
  // owns the trip's real first/last absolute day (aiTripClient.ts's
  // planCitySegments works this out); absent for every other group.
  arrivalDay?: number
  arrivalTime?: string
  departureDay?: number
  departureTime?: string
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { destination, travelStyle, preferences, additionalNotes, totalDays, arrivalDay, arrivalTime, departureDay, departureTime } =
    (req.body ?? {}) as PlanZonesBody
  if (!validateDestination(destination)) {
    res.status(400).json({ error: 'Missing destination' })
    return
  }
  if (!validateTotalDays(totalDays)) {
    res.status(400).json({ error: 'Invalid totalDays' })
    return
  }
  // Bounds-checked the same way generate-trip-day.ts validates its own
  // `day` field — a real client only ever sends a value already correct
  // (derived from this same totalDays, see aiTripClient.ts's
  // planCitySegments), so this exists purely as a defensive check at the
  // network boundary against a malformed body reaching buildZonePlanPrompt.
  if (arrivalDay !== undefined && (!Number.isInteger(arrivalDay) || arrivalDay < 1 || arrivalDay > totalDays)) {
    res.status(400).json({ error: 'Invalid arrivalDay' })
    return
  }
  if (departureDay !== undefined && (!Number.isInteger(departureDay) || departureDay < 1 || departureDay > totalDays)) {
    res.status(400).json({ error: 'Invalid departureDay' })
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
    planZones(ctx, totalDays, controller.signal, arrivalDay, arrivalTime, departureDay, departureTime),
    resolveCityCenter(destination, controller.signal),
  ])

  res.status(200).json({ zones, cityCenter })
}

async function planZones(
  ctx: TripContext,
  totalDays: number,
  signal: AbortSignal,
  arrivalDay?: number,
  arrivalTime?: string,
  departureDay?: number,
  departureTime?: string,
): Promise<ZoneHint[]> {
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
        messages: [{ role: 'user', content: buildZonePlanPrompt(ctx, totalDays, arrivalDay, arrivalTime, departureDay, departureTime) }],
      },
      { signal },
    )
    const response = await stream.finalMessage()
    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return []
    const parsed = JSON.parse(textBlock.text) as { days?: ZoneHint[] }
    // assignedPreferences is free-text-adjacent (the schema only constrains
    // it to an array of strings, not to the user's actual preference list),
    // so it's sanitized against ctx.preferences here — a hallucinated or
    // paraphrased value would otherwise flow straight into
    // generate-trip-day.ts's "今天請至少包含..." instruction referencing a
    // preference the user never actually selected.
    const validPreferences = new Set(ctx.preferences ?? [])
    return (parsed.days ?? [])
      .filter((entry) => Number.isInteger(entry.day) && entry.day >= 1 && entry.day <= totalDays)
      .map((entry) => ({
        ...entry,
        assignedPreferences: (entry.assignedPreferences ?? []).filter((preference) => validPreferences.has(preference)),
      }))
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
