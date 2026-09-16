// Length ceilings for every client-supplied field that gets interpolated
// into a Claude prompt (api/ask-ai.ts, api/plan-trip-zones.ts,
// api/generate-trip-day.ts). rateLimitRules.ts counts requests, not tokens.
// Without these, one request that skips the UI and calls an endpoint
// directly could stuff an arbitrarily long string into the prompt, costing
// many times a normal request's input tokens while still counting as a
// single call. max_tokens only bounds the output side.
//
// Sized well above anything the real UI sends. The matching form fields
// carry their own maxlength (src/data/generateTrip.ts's
// DESTINATION_INPUT_MAX_LENGTH / ADDITIONAL_NOTES_MAX_LENGTH,
// src/data/askAiClient.ts's ASK_AI_MESSAGE_MAX_LENGTH), kept in sync by hand
// since api/ and src/ are independent deployable units. Err generous: a 400
// from generate-trip-day.ts fails the whole trip creation (see
// aiTripClient.ts), it doesn't just degrade it.
//
// Its own module rather than part of tripGen.ts so api/ask-ai.ts can share
// it without importing trip-generation code (see tripGen.ts's
// VercelLikeRequest comment for that existing boundary).

// Every ceiling on a field the user types into is double that form field's
// maxlength, never equal to it. maxlength isn't a reliable client-side cap:
// DestinationAutocomplete.vue writes a selected suggestion's composed
// "City，Country" label into its field programmatically (maxlength doesn't
// truncate programmatic values), and some mobile browsers don't enforce
// maxlength on IME-composed input (注音/倉頡), so a real user can land a
// little past it.
export const MAX_DESTINATION_LENGTH = 200
export const MAX_NOTES_LENGTH = 1000
// travelStyle / preferences. The form's real option lists are 2 and 10 short
// fixed labels (src/data/mockPreferences.ts), so these only leave room for
// those lists to grow.
export const MAX_TAG_COUNT = 20
export const MAX_TAG_LENGTH = 50
// zone/focus text is plan-trip-zones.ts's own Claude output relayed back
// through the client, so it's truncated to this rather than rejected (see
// sanitizeZoneHints in tripGen.ts).
export const MAX_ZONE_TEXT_LENGTH = 200

export const MAX_ASK_AI_MESSAGE_LENGTH = 1000
// A multi-city trip's destination is every city name joined with '・' (see
// displayDestination in src/data/generateTrip.ts), up to 8 cities.
export const MAX_ASK_AI_DESTINATION_LENGTH = 2000
// TripBoardPage.vue's addDay has no cap of its own, so these are sanity
// ceilings, not product limits. A request past them only makes
// AskAiPanel.vue fall back to its keyword heuristics (fetchAskAiResult
// returns undefined on any non-OK status); the chat itself keeps working.
export const MAX_ASK_AI_COLUMNS = 60
export const MAX_ASK_AI_PLACES = 200
export const MAX_ID_LENGTH = 64
// Truncated in ask-ai.ts's buildPrompt rather than rejected: TripBoardPage.vue's
// place editor lets a user save a name of any length, and rejecting it would
// silently disable Claude for every later message on that trip.
export const MAX_PLACE_NAME_LENGTH = 100
export const MAX_CATEGORY_LENGTH = 32

export function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
}

// Plain String.slice(0, n) counts UTF-16 code units, so it can cut an astral
// character (an emoji, mostly — e.g. a place name a user saved with one) in
// half, leaving a lone surrogate in the prompt text. Array.from splits on
// code points instead, so a truncation here always lands on a whole
// character. Used wherever a value is shortened rather than rejected
// (ask-ai.ts's buildPrompt, tripGen.ts's sanitizeZoneHints) — every reject
// path just compares .length, which doesn't need this (a lone surrogate pair
// makes the string one code unit longer either way, so the ceiling still
// does its job of bounding worst-case prompt size).
export function truncateToCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('')
}

// Absent passes: every array field this guards is optional in its body type.
export function isOptionalBoundedStringArray(value: unknown, maxCount: number, maxLength: number): boolean {
  if (value === undefined) return true
  return Array.isArray(value) && value.length <= maxCount && value.every((item) => isBoundedString(item, maxLength))
}
