import { kvGet, kvSet } from './_lib/kv.js'

// Proxies a Google Places (New) photo resource to an actual image URL,
// without ever handing the server's GOOGLE_PLACES_API_KEY to the browser.
//
// Google's Photo (New) media endpoint, when called with skipHttpRedirect
// unset (false), answers with an HTTP redirect to the real, key-free
// lh3.googleusercontent.com image — so this function calls that endpoint
// itself (redirect: 'manual', so fetch doesn't follow it and burn our own
// bandwidth proxying image bytes), reads the Location header, and re-issues
// that same redirect to the browser. The key is only ever seen server-side;
// the client only ever sees Google's CDN URL.
//
// Unlike placesVerify.ts's photoRef *lookup* (cached 30-90 days), resolving
// an already-known ref into this redirect had no server-side cache at all —
// every request re-hit Google, for every visitor, even for the Explore
// page's fixed, shared set of photoRefs that every visitor loads identically.
// Confirmed live: that's a real source of the "some thumbnails take a while"
// complaint, on top of unavoidable cold-start latency. MEDIA_CACHE_TTL_SECONDS
// below caches the resolved redirect (or a confirmed-stale negative) so the
// second visitor — or the second card on the same page — gets a KV hit
// instead of paying Google's round trip again.
//
// Loosely typed request/response on purpose, same reasoning as
// generate-trip-day.ts's VercelLikeRequest/Response — avoids pulling in
// @vercel/node's type package for one small function. Vercel's real runtime
// response object does support setHeader/end (it's a real http.ServerResponse
// under the hood), this just doesn't declare the full type.
type VercelLikeRequest = {
  method?: string
  query?: Record<string, string | string[] | undefined>
}
type VercelLikeResponse = {
  status: (code: number) => VercelLikeResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
  end: () => void
}

const MEDIA_URL_BASE = 'https://places.googleapis.com/v1'

// Shorter than the browser's own 1-hour Cache-Control below (see the 404
// branch's comment on why: Google's redirect target isn't a permanent CDN
// URL), so a server-side hit can never outlive the freshness assumption a
// browser is already relying on for its own cached copy.
const MEDIA_CACHE_TTL_SECONDS = 50 * 60

// A negative result (stale ref, or any other non-redirect response — see the
// 404 branch below) gets a much shorter TTL than a real hit. Google's status
// code alone can't distinguish "this specific ref is stale" from "our own
// GOOGLE_PLACES_API_KEY got revoked/quota-cut" (both plausibly surface as a
// 400/403, confirmed live during this file's own testing) — caching the
// latter at MEDIA_CACHE_TTL_SECONDS would mean fixing the key doesn't bring
// photos back for up to 50 minutes, for every place hit during the outage.
// 5 minutes still meaningfully cuts repeat Google calls for a genuinely dead
// ref without locking in a config-level outage for nearly an hour.
const NEGATIVE_CACHE_TTL_SECONDS = 5 * 60

type CachedPhoto = { location: string; cachedAt: number }

const BROWSER_CACHE_MAX_AGE_SECONDS = 3600
// Floor so a KV hit served right before the entry's own TTL expiry doesn't
// hand the browser a max-age of 0 (or, if clocks disagree even slightly,
// negative) — same reasoning as MEDIA_CACHE_TTL_SECONDS staying under this
// budget, just guaranteeing a small positive floor at the serving end too.
const MIN_BROWSER_CACHE_MAX_AGE_SECONDS = 60

// Scopes the browser's own cache lifetime to how much of
// BROWSER_CACHE_MAX_AGE_SECONDS is actually left, counted from when this
// redirect was first resolved (cachedAt) — not from "now" on every response.
// Without this, a KV cache hit re-issuing a fresh max-age=3600 on an
// already-49-minutes-old redirect would tell the browser to keep replaying
// it for another hour on top of that, well past the freshness window this
// was meant to stay inside (confirmed live: Google's redirect target isn't
// a permanent CDN URL — see the 404 branch below).
function respondWithRedirect(res: VercelLikeResponse, cached: CachedPhoto) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - cached.cachedAt) / 1000))
  const maxAge = Math.max(MIN_BROWSER_CACHE_MAX_AGE_SECONDS, BROWSER_CACHE_MAX_AGE_SECONDS - ageSeconds)
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`)
  res.setHeader('Location', cached.location)
  res.status(302).end()
}

// Google Places (New) photo resource names look like
// "places/ChIJ.../photos/AUc...". Validated strictly before it's ever
// interpolated into a URL we fetch server-side — an unvalidated ref would
// let a caller redirect this function's own outbound request anywhere.
const PHOTO_REF_PATTERN = /^places\/[\w-]+\/photos\/[\w-]+$/

const DEFAULT_WIDTH_PX = 240
const MIN_WIDTH_PX = 64
// 1000 comfortably covers the drawer banner (.place-drawer__image, 500px
// CSS-wide per $map-panel-width) at 2x device pixel ratio.
const MAX_WIDTH_PX = 1000

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    res.status(404).end()
    return
  }

  const ref = req.query?.ref
  if (typeof ref !== 'string' || !PHOTO_REF_PATTERN.test(ref)) {
    res.status(400).json({ error: 'Invalid photo ref' })
    return
  }

  const requestedWidth = Number(req.query?.w)
  const maxWidthPx = Number.isFinite(requestedWidth)
    ? Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, Math.round(requestedWidth)))
    : DEFAULT_WIDTH_PX

  // Width is part of the key — Google bakes the requested size into the
  // redirect target itself (confirmed live: the CDN URL ends in `-w${width}`),
  // so a 64px thumbnail and a 1000px drawer banner for the same place are
  // genuinely different cached values, not the same one requested twice.
  const cacheKey = `media:${ref}:${maxWidthPx}`

  const cached = await kvGet<CachedPhoto | null>(cacheKey)
  if (cached !== undefined) {
    if (cached === null) {
      res.status(404).end()
      return
    }
    respondWithRedirect(res, cached)
    return
  }

  try {
    const googleUrl = `${MEDIA_URL_BASE}/${ref}/media?maxWidthPx=${maxWidthPx}&key=${apiKey}`
    const googleRes = await fetch(googleUrl, { redirect: 'manual' })
    const location = googleRes.headers.get('location')

    // 429/5xx are Google having a bad moment, not "this place has no photo"
    // — collapsing them into the same 404 as a genuine miss would make a
    // transient rate limit look permanent to the frontend (which never
    // retries a failed <img>, see usePlacePhoto.ts). Answering 502 instead
    // keeps this in the same "transient, not cached" bucket as the network
    // failures caught below — caching a 429 at all would turn one bad moment
    // into an outage for every visitor sharing that cache key.
    if (googleRes.status === 429 || googleRes.status >= 500) {
      res.status(502).end()
      return
    }
    if (googleRes.status < 300 || googleRes.status >= 400 || !location) {
      // TEMP DIAGNOSTIC — 2026-09-29, remove once root cause of the
      // site-wide photo outage is confirmed. This branch used to swallow
      // Google's actual status/body, so Vercel logs only ever showed our
      // own 404 with nothing to say why. Autocomplete works on the same
      // key, so this should narrow it down to a Photo-specific quota/
      // billing/restriction issue vs something else.
      const diagnosticBody = await googleRes.text().catch(() => '<unreadable>')
      console.error('[place-photo] non-redirect response from Google', {
        status: googleRes.status,
        body: diagnosticBody.slice(0, 500),
      })

      // A photo ref can go stale (Google docs note these aren't permanent)
      // or the place may since have lost its photo — either way this is a
      // permanent-for-now negative, not a retry-me error. The frontend's
      // <img> falls back to the decorative gradient on this. Cached (briefly
      // — see NEGATIVE_CACHE_TTL_SECONDS) so a known-stale ref isn't re-billed
      // to Google on every single visitor's page load.
      kvSet(cacheKey, null, NEGATIVE_CACHE_TTL_SECONDS)
      res.status(404).end()
      return
    }

    const cachedPhoto: CachedPhoto = { location, cachedAt: Date.now() }
    kvSet(cacheKey, cachedPhoto, MEDIA_CACHE_TTL_SECONDS)
    respondWithRedirect(res, cachedPhoto)
  } catch (error) {
    console.error('place-photo failed', error)
    res.status(502).end()
  }
}
