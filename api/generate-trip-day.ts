import Anthropic from '@anthropic-ai/sdk'
import { stripBilingualName } from './_lib/placeName.js'
import { distanceKm, geocodeCityCenter, getPlaceCoverPhotos, verifyPlace, type GeoPoint } from './_lib/placesVerify.js'
import {
  buildDayPrompt,
  buildDaySystemPrompt,
  mapWithConcurrency,
  overAskCountFor,
  PLACE_SCHEMA,
  validateDestination,
  validateTimeWindow,
  validateTotalDays,
  type AiPlace,
  type TripContext,
  type VercelLikeRequest,
  type VercelLikeResponse,
  type ZoneHint,
} from './_lib/tripGen.js'

// Computed once at module scope, not per-request — buildDaySystemPrompt()
// takes no arguments and its output never changes, so building it fresh on
// every invocation would be pure waste. Sent as a cached `system` block (see
// its own comment) so this exact text is billed once per cache window
// instead of once per day-request.
const DAY_SYSTEM_PROMPT = buildDaySystemPrompt()

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

// Full-day fallback window — used only if a request arrives without
// windowStart/windowEnd (an old/malformed client body), so this endpoint
// degrades gracefully instead of 400ing on a field that used to be optional
// before day-length windows existed.
const DEFAULT_WINDOW_START = '08:00'
const DEFAULT_WINDOW_END = '21:00'

type GenerateTripDayBody = TripContext & {
  totalDays?: number
  day?: number
  // A soft, derived target — see targetCountForWindow in
  // src/data/generateTrip.ts. No longer an exact cap enforced here (see the
  // accepted-loop below); the real trim now happens client-side once each
  // candidate's real estimatedTimeHours is known.
  targetPlaceCount?: number
  // 'HH:mm' local time — the day's active-hours window, sized by pace and
  // narrowed for a flight-affected day (see dayWindowForPace/
  // windowForFlightDay in src/data/generateTrip.ts). Feeds buildDayPrompt's
  // window-first framing.
  windowStart?: string
  windowEnd?: string
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
  // 'HH:mm' local time — sent only for the day it actually affects (day 1's
  // arrival, the trip's last day's departure; see aiTripClient.ts's
  // requestDay), feeds buildDayPrompt's flight-aware candidate steering.
  arrivalTime?: string
  departureTime?: string
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
    targetPlaceCount,
    windowStart,
    windowEnd,
    zones,
    cityCenter: bodyCityCenter,
    existingAnchor,
    arrivalTime,
    departureTime,
  } = (req.body ?? {}) as GenerateTripDayBody

  if (!validateDestination(destination)) {
    res.status(400).json({ error: 'Missing destination' })
    return
  }
  if (!validateTotalDays(totalDays)) {
    res.status(400).json({ error: 'Invalid totalDays' })
    return
  }
  if (!Number.isInteger(targetPlaceCount) || targetPlaceCount! < 1 || targetPlaceCount! > 10) {
    res.status(400).json({ error: 'Invalid targetPlaceCount' })
    return
  }
  if (!Number.isInteger(day) || day! < 1 || day! > totalDays) {
    res.status(400).json({ error: 'Invalid day' })
    return
  }
  // Both absent (an old/malformed client body predating day-length windows)
  // falls back to the full-day default below; either one present without
  // being a well-formed, correctly-ordered 'HH:mm' pair is rejected outright
  // rather than silently degrading the AI prompt with garbage/reversed times.
  const windowProvided = typeof windowStart !== 'undefined' || typeof windowEnd !== 'undefined'
  if (windowProvided && !validateTimeWindow(windowStart, windowEnd)) {
    res.status(400).json({ error: 'Invalid windowStart/windowEnd' })
    return
  }
  const effectiveWindowStart = typeof windowStart === 'string' ? windowStart : DEFAULT_WINDOW_START
  const effectiveWindowEnd = typeof windowEnd === 'string' ? windowEnd : DEFAULT_WINDOW_END

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
        // Cached — see DAY_SYSTEM_PROMPT/buildDaySystemPrompt's own comment.
        // Render order is tools -> system -> messages, and prompt caching is
        // a prefix match, so this has to stay ahead of (and byte-identical
        // across) every request for the breakpoint to ever be read instead
        // of rewritten. Only one breakpoint needed: everything here is
        // static, so there's nothing later in `system` that would need its
        // own marker.
        system: [{ type: 'text', text: DAY_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: buildDayPrompt(ctx, day!, totalDays!, targetPlaceCount!, effectiveWindowStart, effectiveWindowEnd, zoneHints, arrivalTime, departureTime),
          },
        ],
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
    // cache_read_input_tokens > 0 confirms the system-prompt cache breakpoint
    // above is actually being hit in production, not just correctly
    // configured — see buildDaySystemPrompt's own comment for why this
    // exists. cache_creation_input_tokens is expected to be nonzero on
    // whichever request in a cache window happens to run first (it pays the
    // one-time write); a sustained run of zero cache_read across many
    // requests, with no corresponding cache_creation, is the sign of a
    // silent invalidator, not proof the feature isn't working.
    console.log(
      `[generate-trip-day] day ${day}: ${aiPlaces.length} candidates, ${Date.now() - handlerStart}ms elapsed, cache read/write tokens: ${response.usage.cache_read_input_tokens ?? 0}/${response.usage.cache_creation_input_tokens ?? 0}`,
    )

    const googleKey = process.env.GOOGLE_PLACES_API_KEY
    if (!googleKey) {
      // No Places key configured — hand back the AI's picks (still
      // day-tagged) without coordinates; the client geocodes via Nominatim
      // as before. src/data/generateTrip.ts trims each day to its own
      // duration-budget window itself, so returning the full over-asked list
      // here is fine.
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
      return { ...place, name: verifiedName, lat: hit.lat, lng: hit.lng, placeId: hit.placeId, photoRef: hit.photoRef }
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

    // Guard against this day's candidates spanning an impractically wide
    // area — a candidate can be real and in-bounds for the whole city while
    // still being far from the other places already accepted for this day.
    // existingAnchor (backfill requests only) seeds this from the first
    // pass's already-accepted places for the SAME day, so a backfill
    // candidate has to be geographically consistent with what's already
    // there — otherwise the first accepted candidate here becomes the
    // anchor, same as a first-pass request.
    // 40km (not a tight single-neighborhood radius) so a day trip inside a
    // region-scale destination (e.g. a "美瑛/富良野" day within a 北海道
    // trip, where the flower fields and viewpoints genuinely spread over
    // 20-30km) doesn't get gutted the same way MAX_KM_FROM_CITY above did.
    const MAX_KM_FROM_DAY_ANCHOR = 40
    // A loose sanity ceiling, not an exact cap — the precise trim against
    // this day's real duration budget happens client-side in
    // generateTrip.ts once every candidate's estimatedTimeHours is known.
    // See overAskCountFor's own comment for why it's sized targetPlaceCount +
    // PER_DAY_BUFFER with no further clamp.
    const MAX_ACCEPTED_PER_DAY = overAskCountFor(targetPlaceCount!)
    let anchor: GeoPoint | null = existingAnchor ?? null
    const accepted: typeof deduped = []
    for (const hit of deduped) {
      if (accepted.length >= MAX_ACCEPTED_PER_DAY) break
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

    // Photos are fetched here, per accepted place — not inside verifyPlace's
    // bulk Text Search above — so this trip only pays for a photo on places
    // that actually made it into the itinerary, not every over-asked
    // candidate (see verifyPlace's own comment). A place with no Google photo
    // on record, or whose fetch fails, is left with no photoRef — already a
    // normal, well-handled case (see Place.photoRef in src/types/index.ts),
    // so this is best-effort and never fails the whole request.
    //
    // Only fetched for the first targetPlaceCount of `accepted` (in the AI's
    // own confidence order, preserved through dedup/anchor-filtering above),
    // not the full over-asked+buffered list — targetPlaceCount is the soft
    // target the client's duration-budget walk actually aims to fill (see
    // its own comment in generateTrip.ts), while the PER_DAY_BUFFER
    // candidates beyond it exist purely as backup against verification loss
    // (see overAskCountFor's own comment) and, on a day with little or no
    // attrition, usually don't survive that walk's trim. Paying Enterprise-
    // tier pricing (see getPlaceCoverPhotos' own comment) for a photo on
    // backup candidates that are more often discarded than kept is exactly
    // the over-ask buffer's cost leaking into a step it was never meant to
    // reach. A backup candidate that DOES survive the trim just has no
    // photoRef — the same well-handled case as any other photo-fetch miss.
    const photoEligible = accepted.slice(0, targetPlaceCount!)
    const withPhotosForEligible = await mapWithConcurrency(photoEligible, VERIFY_CONCURRENCY, async (place) => {
      try {
        const photos = await getPlaceCoverPhotos(googleKey, place.placeId, controller.signal)
        return { ...place, photoRef: photos[0] ?? place.photoRef }
      } catch {
        return place
      }
    })
    const withPhotos = [...withPhotosForEligible, ...accepted.slice(targetPlaceCount!)]

    console.log(`[generate-trip-day] done: ${Date.now() - handlerStart}ms elapsed, day ${day}, returning ${withPhotos.length} places`)
    res.status(200).json({ places: withPhotos })
  } catch (error) {
    console.error('generate-trip-day failed', error)
    res.status(502).json({ error: 'AI generation failed' })
  }
}
