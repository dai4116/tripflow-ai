import { getPlaceLocation } from './_lib/placesVerify.ts'

export const config = { maxDuration: 10 }

type VercelLikeRequest = {
  method?: string
  body?: unknown
  on?: (event: 'close', listener: () => void) => void
}
type VercelLikeResponse = {
  status: (code: number) => VercelLikeResponse
  json: (body: unknown) => void
}

type PlaceDetailsBody = { placeId?: string; sessionToken?: string }

// Google's Place ID reference docs say length "may vary (there is no maximum
// length for place IDs)" and don't document a restricted character set, so
// this isn't asserting Google's actual format — it's a basic sanity check
// (reject empty/absurd/garbage input before spending a billed Google call on
// it), bounded generously so it doesn't reject a legitimate id. Unlike
// place-photo.ts's PHOTO_REF_PATTERN check on `ref` (interpolated raw into a
// URL), the actual safety property here — this value can't redirect
// getPlaceLocation's outbound request anywhere unexpected — already comes
// from getPlaceLocation wrapping it in encodeURIComponent, not from this
// regex.
const PLACE_ID_PATTERN = /^[\w.~-]{1,2048}$/

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    res.status(404).json({ error: 'Place details not configured' })
    return
  }

  const { placeId, sessionToken } = (req.body ?? {}) as PlaceDetailsBody
  if (typeof placeId !== 'string' || !PLACE_ID_PATTERN.test(placeId)) {
    res.status(400).json({ error: 'Invalid placeId' })
    return
  }
  if (typeof sessionToken !== 'string' || !sessionToken.trim()) {
    res.status(400).json({ error: 'Missing sessionToken' })
    return
  }

  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  try {
    const point = await getPlaceLocation(apiKey, placeId, sessionToken, controller.signal)
    if (!point) {
      res.status(404).json({ error: 'Place not found' })
      return
    }
    res.status(200).json(point)
  } catch (error) {
    console.error('place-details failed', error)
    res.status(502).json({ error: 'Place details failed' })
  }
}
