import { getPlaceCoverPhotos } from './_lib/placesVerify.js'

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

type PlaceCoverPhotosBody = { placeId?: string }

// Same sanity-check reasoning as place-details.ts's identical pattern — not
// asserting Google's actual place-id format, just rejecting empty/absurd
// input before spending a billed Google call on it.
const PLACE_ID_PATTERN = /^[\w.~-]{1,2048}$/

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    res.status(404).json({ error: 'Cover photos not configured' })
    return
  }

  const { placeId } = (req.body ?? {}) as PlaceCoverPhotosBody
  if (typeof placeId !== 'string' || !PLACE_ID_PATTERN.test(placeId)) {
    res.status(400).json({ error: 'Invalid placeId' })
    return
  }

  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  try {
    const photoRefs = await getPlaceCoverPhotos(apiKey, placeId, controller.signal)
    res.status(200).json({ photoRefs })
  } catch (error) {
    console.error('place-cover-photos failed', error)
    res.status(502).json({ error: 'Cover photos failed' })
  }
}
