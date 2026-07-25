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

  try {
    const googleUrl = `${MEDIA_URL_BASE}/${ref}/media?maxWidthPx=${maxWidthPx}&key=${apiKey}`
    const googleRes = await fetch(googleUrl, { redirect: 'manual' })
    const location = googleRes.headers.get('location')

    // 429/5xx are Google having a bad moment, not "this place has no photo"
    // — collapsing them into the same 404 as a genuine miss would make a
    // transient rate limit look permanent to the frontend (which never
    // retries a failed <img>, see usePlacePhoto.ts). Answering 502 instead
    // keeps this in the same "transient, not cached" bucket as the network
    // failures caught below.
    if (googleRes.status === 429 || googleRes.status >= 500) {
      res.status(502).end()
      return
    }
    if (googleRes.status < 300 || googleRes.status >= 400 || !location) {
      // A photo ref can go stale (Google docs note these aren't permanent)
      // or the place may since have lost its photo — either way this is a
      // permanent-for-now negative, not a retry-me error. The frontend's
      // <img> falls back to the decorative gradient on this.
      res.status(404).end()
      return
    }

    // Google's redirect target is itself short-lived (not a permanent CDN
    // URL) — caching it as long as `ref`'s own freshness (see place-photo's
    // 404 branch above) would let the browser replay an expired Google URL
    // straight past our server. An hour comfortably outlives a page session
    // while staying well inside that window.
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Location', location)
    res.status(302).end()
  } catch (error) {
    console.error('place-photo failed', error)
    res.status(502).end()
  }
}
