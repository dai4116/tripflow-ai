import type { PlaceCategory } from '../types'
import type { PlaceSuggestion } from './generateTrip'

// Chat replies are small — no whole-itinerary generation involved — so a
// shorter budget than aiTripClient.ts's 30s is enough while still covering
// a cold start.
const REQUEST_TIMEOUT_MS = 20000

export type AskAiColumnSummary = {
  id: string
  dayNumber: number
  title: string
  places: { id: string; name: string; category: PlaceCategory }[]
}

export type AskAiResult =
  | { type: 'move_place'; placeId: string; toColumnId: string; message: string }
  | { type: 'remove_place'; placeId: string; message: string }
  | { type: 'suggest_places'; columnId: string; places: PlaceSuggestion[]; message: string }
  | { type: 'text'; text: string }

// Talks to /api/ask-ai (a Vercel serverless function using Claude tool use
// to decide move/remove/suggest vs. a plain reply). Returns undefined —
// never throws — on any failure: no route in local `vite dev`, missing
// ANTHROPIC_API_KEY, timeout, or a malformed response, so the panel can
// fall back to its own keyword heuristics instead of breaking the chat.
export async function fetchAskAiResult(
  message: string,
  destination: string,
  columns: AskAiColumnSummary[],
): Promise<AskAiResult | undefined> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch('/api/ask-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, destination, columns }),
      signal: controller.signal,
    })
    if (!response.ok) return undefined

    const data = (await response.json()) as { type?: string; name?: string; input?: Record<string, unknown>; text?: string }

    if (data.type === 'text') {
      return { type: 'text', text: typeof data.text === 'string' ? data.text : '了解。' }
    }

    if (data.type !== 'tool_use' || !data.input) return undefined
    const input = data.input
    const message_ = typeof input.message === 'string' ? input.message : ''

    if (data.name === 'move_place' && typeof input.placeId === 'string' && typeof input.toColumnId === 'string') {
      return { type: 'move_place', placeId: input.placeId, toColumnId: input.toColumnId, message: message_ }
    }
    if (data.name === 'remove_place' && typeof input.placeId === 'string') {
      return { type: 'remove_place', placeId: input.placeId, message: message_ }
    }
    if (data.name === 'suggest_places' && typeof input.columnId === 'string' && Array.isArray(input.places)) {
      return { type: 'suggest_places', columnId: input.columnId, places: input.places as PlaceSuggestion[], message: message_ }
    }

    return undefined
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}
