import { autocompletePlaces } from './_lib/placesVerify.ts'

// Chat-speed budget, matching places-search.ts — this fires per debounced
// keystroke from DestinationAutocomplete.vue, not per trip generation.
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

type PlacesAutocompleteBody = { input?: string; sessionToken?: string }

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    res.status(404).json({ error: 'Autocomplete not configured' })
    return
  }

  const { input, sessionToken } = (req.body ?? {}) as PlacesAutocompleteBody
  const trimmedInput = typeof input === 'string' ? input.trim() : ''
  if (!trimmedInput) {
    res.status(400).json({ error: 'Missing input' })
    return
  }
  if (typeof sessionToken !== 'string' || !sessionToken.trim()) {
    res.status(400).json({ error: 'Missing sessionToken' })
    return
  }

  // If the client gives up (a newer keystroke superseded this request, the
  // field lost focus), stop the in-flight Google call instead of paying for
  // a response nobody will read — same pattern as places-search.ts.
  const controller = new AbortController()
  req.on?.('close', () => controller.abort())

  try {
    const suggestions = await autocompletePlaces(apiKey, trimmedInput, sessionToken, controller.signal)
    res.status(200).json({ suggestions })
  } catch (error) {
    console.error('places-autocomplete failed', error)
    res.status(502).json({ error: 'Autocomplete failed' })
  }
}
