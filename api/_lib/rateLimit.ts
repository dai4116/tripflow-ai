import { kvIncr } from './kv.js'

// Three independent counters per endpoint, each answering a different
// question: is this ONE visitor bursting right now (session/10min), is this
// ONE visitor using more than their fair share of the day (session/day), and
// has the SITE overall used more than its budget can absorb today
// (global/day) — see CLAUDE.md-adjacent conversation history for the full
// reasoning. All three are checked on every call regardless of whether an
// earlier one already failed, so a blocked burst still counts toward the
// day totals instead of getting a free retry loophole.
//
// sessionPer10Min/sessionPerDay are optional — generate-trip-day.ts uses only
// globalPerDay (see its own comment on why session-level limits there would
// risk blocking some days of an already-approved trip but not others).
export type RateLimitRule = {
  // Used as part of the Redis key — keep stable across deploys, or existing
  // counters orphan and silently reset.
  endpoint: string
  sessionPer10Min?: number
  sessionPerDay?: number
  globalPerDay: number
}

export type RateLimitResult = { allowed: boolean }

const SESSION_10MIN_TTL_SECONDS = 10 * 60

function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10) // YYYY-MM-DD
}

// Calendar-day (UTC) reset, not a rolling 24h window — matches the "resets
// tomorrow" mental model the daily caps were designed around, even though a
// rolling window would smooth out the midnight boundary. +1 second of slack
// costs nothing and avoids an off-by-one if this runs right at the boundary.
function secondsUntilUtcMidnight(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  return Math.ceil((midnight - now.getTime()) / 1000) + 1
}

// visitorId is the frontend's localStorage-generated id (see
// src/data/visitorId.ts) — absent for a client that hasn't loaded/run that
// code yet (very old cached page, JS disabled, a direct API call). Missing
// id just skips the two session-level counters rather than rejecting the
// request outright: the global counter alone still bounds worst-case cost,
// and refusing to serve a legitimate visitor over a missing fingerprint
// would be a worse failure mode than the fairness gap it protects against.
export async function checkRateLimit(visitorId: string | undefined, rule: RateLimitRule): Promise<RateLimitResult> {
  const now = new Date()
  const date = utcDateString(now)
  const dayTtl = secondsUntilUtcMidnight(now)

  const globalKey = `ratelimit:global:${rule.endpoint}:${date}`
  const sessionDayKey =
    visitorId && rule.sessionPerDay !== undefined ? `ratelimit:sessionday:${rule.endpoint}:${visitorId}:${date}` : undefined
  const session10Key =
    visitorId && rule.sessionPer10Min !== undefined ? `ratelimit:session10:${rule.endpoint}:${visitorId}` : undefined

  // All three keys are independent Redis round trips — fired together
  // instead of awaiting the global counter alone before starting the other
  // two, which used to pay two sequential round trips (and, worst case, two
  // sequential KV_TIMEOUT_MS waits) for no reason: nothing about the global
  // count feeds into the session checks or vice versa.
  const [globalCount, sessionDayCount, session10Count] = await Promise.all([
    kvIncr(globalKey, dayTtl),
    sessionDayKey ? kvIncr(sessionDayKey, dayTtl) : Promise.resolve(undefined),
    session10Key ? kvIncr(session10Key, SESSION_10MIN_TTL_SECONDS) : Promise.resolve(undefined),
  ])

  // undefined means KV isn't configured, the call failed, or this rule has
  // no threshold for that counter (kvIncr's own "degrade to unlimited"
  // contract extended the same way to "not checked at all") — not a limit
  // being satisfied. Only a real number compared against a real threshold
  // can trip a block.
  if (globalCount !== undefined && globalCount > rule.globalPerDay) return { allowed: false }
  if (sessionDayCount !== undefined && rule.sessionPerDay !== undefined && sessionDayCount > rule.sessionPerDay) {
    return { allowed: false }
  }
  if (session10Count !== undefined && rule.sessionPer10Min !== undefined && session10Count > rule.sessionPer10Min) {
    return { allowed: false }
  }

  return { allowed: true }
}

// Shared request/response shape both plan-trip-zones.ts and ask-ai.ts already
// declare locally (and generate-trip-day.ts's own VercelLikeRequest/Response
// from tripGen.ts is structurally identical) — kept minimal and structural
// here rather than importing either endpoint's specific type, so this file
// doesn't end up coupled to one caller's type over another's.
type RateLimitableRequest = { headers?: Record<string, string | string[] | undefined> }
type RateLimitableResponse = { status: (code: number) => { json: (body: unknown) => void } }

// Extracts the visitor id header, checks the rule, and writes the 429
// response itself on a block — the exact same 7-line sequence was
// copy-pasted across every endpoint that gates on this. Returns whether the
// caller should proceed; a caller does `if (!(await enforceRateLimit(...)))
// return` right after its method-check, before touching the request body.
export async function enforceRateLimit(req: RateLimitableRequest, res: RateLimitableResponse, rule: RateLimitRule): Promise<boolean> {
  const visitorIdHeader = req.headers?.['x-visitor-id']
  const visitorId = typeof visitorIdHeader === 'string' ? visitorIdHeader : undefined
  const result = await checkRateLimit(visitorId, rule)
  if (!result.allowed) {
    res.status(429).json({ error: 'rate_limited', message: '目前使用量較高，請稍後再試' })
    return false
  }
  return true
}
