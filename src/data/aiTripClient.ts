import type { CreateTripInput } from '../types'
import type { PlaceSuggestion } from './generateTrip'

const REQUEST_TIMEOUT_MS = 12000

// Talks to /api/generate-trip (a Vercel serverless function calling Claude
// Haiku). Returns undefined — never throws — on any failure: no route in
// local `vite dev` (no server there), missing ANTHROPIC_API_KEY, timeout, or
// a malformed response. Callers fall back to the local deterministic
// generator, so a misconfigured or absent key degrades gracefully instead of
// breaking trip creation.
export async function fetchAiPlaces(input: CreateTripInput, placeCount: number): Promise<PlaceSuggestion[] | undefined> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch('/api/generate-trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: input.destination,
        travelStyle: input.travelStyle,
        preferences: input.preferences,
        avoidPlaces: input.avoidPlaces,
        placeCount,
      }),
      signal: controller.signal,
    })
    if (!response.ok) return undefined

    const data = (await response.json()) as { places?: unknown }
    if (!Array.isArray(data.places) || data.places.length === 0) return undefined

    return data.places as PlaceSuggestion[]
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}
