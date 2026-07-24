import Anthropic from '@anthropic-ai/sdk'
import { stripBilingualName } from './_lib/placeName.js'
import { distanceKm, geocodeCityCenter, verifyPlace, type GeoPoint } from './_lib/placesVerify.js'
import {
  buildDayPrompt,
  mapWithConcurrency,
  PLACE_SCHEMA,
  validateDestination,
  validateTotalDays,
  type AiPlace,
  type TripContext,
  type VercelLikeRequest,
  type VercelLikeResponse,
  type ZoneHint,
} from './_lib/tripGen.js'

// Generates + verifies candidates for exactly ONE day, chosen by the caller
// (see DAYS_PER_REQUEST in src/data/aiTripClient.ts). This replaced the old
// single-request-for-the-whole-trip design: that design's total time scaled
// with trip length (risking Vercel's 60s function limit on long trips), and
// its multi-day batches had no way to detect or correct the AI mistagging a
// candidate's day within the same batch — confirmed live, a 7-day trip's
// day 2 came back completely empty while its batch-mate day 1 was full.
// Splitting into many small, client-orchestrated per-day requests removes
// both problems at once: this function's own time cost stays constant
// regardless of total trip length, and a single-day request always gets the
// safe, forced day-tag correction below (an earlier version of this file
// allowed multiple days per request with an unenforced, untested fallback
// for that case — dropped, since nothing ever sent more than one).
export const config = { maxDuration: 30 }

type GenerateTripDayBody = TripContext & {
  totalDays?: number
  day?: number
  placesPerDay?: number
  zones?: ZoneHint[]
  cityCenter?: GeoPoint | null
  // The first-pass day-anchor coordinates, sent only by a backfill request
  // (see aiTripClient.ts's daysNeedingBackfill) for a day that already has
  // some accepted places from an earlier request. Without this, a backfill
  // request has no way to know where THIS day's places already are, and
  // would anchor its own candidates independently — silently allowing a
  // day's final places to span two unrelated parts of the city (confirmed
  // as a real gap in this design's first version). Absent on a first-pass
  // request, where there's nothing yet to anchor to.
  existingAnchor?: GeoPoint | null
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  const handlerStart = Date.now()
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'AI generation not configured' })
    return
  }

  const {
    destination,
    travelStyle,
    preferences,
    additionalNotes,
    totalDays,
    day,
    placesPerDay,
    zones,
    cityCenter: bodyCityCenter,
    existingAnchor,
  } = (req.body ?? {}) as GenerateTripDayBody

  if (!validateDestination(destination)) {
    res.status(400).json({ error: 'Missing destination' })
    return
  }
  if (!validateTotalDays(totalDays)) {
    res.status(400).json({ error: 'Invalid totalDays' })
    return
  }
  if (!Number.isInteger(placesPerDay) || placesPerDay! < 1 || placesPerDay! > 10) {
    res.status(400).json({ error: 'Invalid placesPerDay' })
    return
  }
  if (!Number.isInteger(day) || day! < 1 || day! > totalDays) {
    res.status(400).json({ error: 'Invalid day' })
    return
  }

  const ctx: TripContext = { destination, travelStyle, preferences, additionalNotes }
  const zoneHints = Array.isArray(zones) ? zones : []

  // If the client disconnects (its own timeout fired, tab closed, etc.),
  // stop generating — otherwise Claude finishes the response and we're
  // billed for tokens whose result nobody will ever read. Also passed into
  // the Google Places calls below so a disconnect cancels those too, not
  // just the Claude call.
  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  try {
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream(
      {
        model: 'claude-sonnet-5',
        max_tokens: 8000,
        thinking: { type: 'disabled' },
        output_config: { format: { type: 'json_schema', schema: PLACE_SCHEMA } },
        messages: [{ role: 'user', content: buildDayPrompt(ctx, day!, totalDays!, placesPerDay!, zoneHints) }],
      },
      { signal: controller.signal },
    )
    const response = await stream.finalMessage()
    const textBlock = response.content.find((block) => block.type === 'text')
    const parsed = textBlock && textBlock.type === 'text' ? (JSON.parse(textBlock.text) as { places: AiPlace[] }) : { places: [] }
    const rawPlaces = parsed.places ?? []

    // No ambiguity possible — every candidate belongs to this one day by
    // construction, so force the tag instead of trusting (and risking
    // losing) the model's own day field.
    const mistagged = rawPlaces.filter((place) => place.day !== day).length
    if (mistagged > 0) {
      console.error(`[generate-trip-day] day ${day} had ${mistagged} candidate(s) tagged with the wrong day, corrected`)
    }

    // json_schema output constrains the shape, but not perfectly (a
    // truncated stream, a future model revision) — isolate each candidate's
    // own post-processing so one malformed field drops only that candidate,
    // not the whole request. Nothing here is expected to actually throw in
    // practice; this exists so a rare bad candidate degrades the same way a
    // verification failure does (see mapWithConcurrency's contract comment)
    // instead of taking the whole day down via the outer catch below.
    const aiPlaces: (AiPlace & { name: string })[] = []
    for (const place of rawPlaces) {
      try {
        aiPlaces.push({ ...place, day: day!, name: stripBilingualName(place.name) })
      } catch (error) {
        console.error(`[generate-trip-day] day ${day}: dropped a candidate with an unusable name field`, error)
      }
    }
    console.log(`[generate-trip-day] day ${day}: ${aiPlaces.length} candidates, ${Date.now() - handlerStart}ms elapsed`)

    const googleKey = process.env.GOOGLE_PLACES_API_KEY
    if (!googleKey) {
      // No Places key configured — hand back the AI's picks (still
      // day-tagged) without coordinates; the client geocodes via Nominatim
      // as before. src/data/generateTrip.ts caps each day at placesPerDay
      // itself, so returning the full over-asked list here is fine.
      res.status(200).json({ places: aiPlaces })
      return
    }

    const cityCenter = bodyCityCenter ?? (await geocodeCityCenter(googleKey, destination, controller.signal))

    // 4 (aiTripClient.ts's MAX_PARALLEL_REQUESTS) × this value is the actual
    // worst-case concurrent Google Places load for one trip generation, since
    // each parallel per-day request runs its own independent pool with no
    // cross-request coordination. Kept at the old single-request design's
    // global cap of 8 total (2×4) rather than reusing that same 8 per-request,
    // which would let a full trip generation burst up to 4x as many
    // concurrent Google calls as the old design ever allowed.
    const VERIFY_CONCURRENCY = 2
    const verified = await mapWithConcurrency(aiPlaces, VERIFY_CONCURRENCY, async (place) => {
      const queries = [place.geocodeQuery, place.geocodeQueryAlt].filter((q): q is string => Boolean(q?.trim()))
      if (queries.length === 0) return null
      const hit = await verifyPlace(googleKey, queries, cityCenter, controller.signal)
      if (!hit) return null
      // Show Google's own matched name, not the AI's — a hallucinated or
      // garbled AI name can still fuzzy-match some real nearby place, which
      // gets a real pin but was never actually confirmed to be *that* place.
      const verifiedName = hit.name.trim() ? stripBilingualName(hit.name) : place.name
      return { ...place, name: verifiedName, lat: hit.lat, lng: hit.lng, placeId: hit.placeId }
    })

    // Dedup by Google's placeId within this request's own candidates only.
    // Cross-request duplicates (the same real place picked by two different
    // days' separate requests) can't be caught here — separate requests are
    // separate function invocations with no shared memory — so the client
    // does a final placeId dedup pass after all requests return (see
    // aiTripClient.ts).
    const seenPlaceIds = new Set<string>()
    const deduped = verified.filter((hit): hit is NonNullable<typeof hit> => {
      if (!hit) return false
      if (seenPlaceIds.has(hit.placeId)) return false
      seenPlaceIds.add(hit.placeId)
      return true
    })

    // Cap at placesPerDay, in the AI's own confidence order, and guard
    // against this day's candidates spanning an impractically wide area — a
    // candidate can be real and in-bounds for the whole city while still
    // being far from the other places already accepted for this day.
    // existingAnchor (backfill requests only) seeds this from the first
    // pass's already-accepted places for the SAME day, so a backfill
    // candidate has to be geographically consistent with what's already
    // there — otherwise the first accepted candidate here becomes the
    // anchor, same as a first-pass request.
    const MAX_KM_FROM_DAY_ANCHOR = 12
    let anchor: GeoPoint | null = existingAnchor ?? null
    const accepted: typeof deduped = []
    for (const hit of deduped) {
      if (accepted.length >= placesPerDay!) break
      const hitPoint: GeoPoint = { lat: hit.lat, lng: hit.lng }
      if (anchor) {
        const km = distanceKm(anchor, hitPoint)
        if (km > MAX_KM_FROM_DAY_ANCHOR) {
          console.error(`[generate-trip-day] day ${day}: dropped "${hit.name}" — ${km.toFixed(1)}km from the day's anchor`)
          continue
        }
      } else {
        anchor = hitPoint
      }
      accepted.push(hit)
    }

    if (accepted.length === 0) {
      // Nothing verified for this day — surface as a failure. The client
      // treats this the same as any other day that came up short: it's
      // covered by the post-merge backfill round in aiTripClient.ts, not by
      // anything in this function retrying itself.
      res.status(502).json({ error: 'No verifiable places' })
      return
    }
    console.log(`[generate-trip-day] done: ${Date.now() - handlerStart}ms elapsed, day ${day}, returning ${accepted.length} places`)
    res.status(200).json({ places: accepted })
  } catch (error) {
    console.error('generate-trip-day failed', error)
    res.status(502).json({ error: 'AI generation failed' })
  }
}
