import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto'
import { kvGetLog, kvGetRaw, kvIncr, kvLogEvent, kvMGetRaw } from '../_lib/kv.js'
import { globalCounterKey, utcDateString } from '../_lib/rateLimit.js'
import { ASK_AI_RULE, GENERATE_TRIP_DAY_RULE, PLAN_TRIP_ZONES_RULE } from '../_lib/rateLimitRules.js'

// Read-only, admin-only view over the same global rate-limit counters
// api/_lib/rateLimit.ts already writes on every request — no separate
// logging path, just a longer-lived read of data that already exists (see
// rateLimit.ts's GLOBAL_COUNTER_TTL_SECONDS comment). Rules come from
// rateLimitRules.ts (not each endpoint's own handler file) so this
// function's bundle doesn't pull in the Anthropic SDK / tripGen / placesVerify
// module graph those handlers carry, just to read {endpoint, globalPerDay}.
const ENDPOINTS: { label: string; rule: { endpoint: string; globalPerDay: number } }[] = [
  { label: '行程分區規劃', rule: PLAN_TRIP_ZONES_RULE },
  { label: '單日行程生成', rule: GENERATE_TRIP_DAY_RULE },
  { label: 'AI 行程助手', rule: ASK_AI_RULE },
]

// Matches rateLimit.ts's GLOBAL_COUNTER_TTL_SECONDS (60 days) — asking for
// more than this just returns days whose counters have already expired
// (read back as 0), so there's no point allowing a larger range.
const MAX_HISTORY_DAYS = 60
const DEFAULT_HISTORY_DAYS = 14

// Global (not per-IP — this app has no IP tracking anywhere) lockout on
// wrong-secret guesses, keyed only by failures — a legitimate admin
// refreshing the dashboard repeatedly never counts against this, only actual
// mismatches do. Every other endpoint in this codebase checks
// enforceRateLimit before doing any work; this one has no visitor id to key
// off of (it's not a visitor-facing endpoint), so failed guesses count
// against one shared bucket instead — a burst of wrong guesses locks the
// dashboard for everyone, including the real admin, for the rest of the
// window. That trade-off is fine here: this is a single-operator panel, not
// a multi-tenant surface, so "temporarily locked out after abuse" is an
// acceptable cost for "not brute-forceable".
const AUTH_FAIL_LIMIT = 20
const AUTH_FAIL_KEY = 'ratelimit:admin-auth-fail'
const AUTH_FAIL_WINDOW_SECONDS = 10 * 60

// Monitoring only, not identity tracking — deliberately no IP, no visitor
// id, nothing that could be used to profile who tried. Just "when, and did
// it work" so a real question ("did my friend's test actually reach the
// server yesterday?") is answerable from inside the dashboard itself,
// without depending on Vercel's own function-log retention window (short on
// the Hobby tier, and gone entirely once it rolls off).
type AuthLogEntry = { timestamp: string; outcome: 'success' | 'fail' }
const AUTH_LOG_KEY = 'admin-auth-log'
const AUTH_LOG_MAX_ENTRIES = 50

type VercelLikeRequest = {
  method?: string
  query?: Record<string, string | string[] | undefined>
  headers?: Record<string, string | string[] | undefined>
}
type VercelLikeResponse = {
  status: (code: number) => VercelLikeResponse
  json: (body: unknown) => void
}

// Oldest first, so the chart reads left-to-right chronologically — includes
// today (i = 0) as the last entry.
function lastNDates(n: number): string[] {
  const now = new Date()
  const dates: string[] = []
  for (let i = 0; i < n; i++) {
    dates.push(utcDateString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))))
  }
  return dates.reverse()
}

// Hashes both sides to a fixed-length digest before the constant-time
// compare, so unequal input lengths never take a different code path (a raw
// crypto.timingSafeEqual throws on mismatched buffer lengths, which would
// otherwise force a manual, variable-time length check right back in). This
// is what a hand-rolled XOR loop can't give you: the loop itself was
// provably constant-time, but its `a.length !== b.length` early exit before
// it was not.
function secretsMatch(provided: string, configured: string): boolean {
  const providedHash = createHash('sha256').update(provided).digest()
  const configuredHash = createHash('sha256').update(configured).digest()
  return cryptoTimingSafeEqual(providedHash, configuredHash)
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const configuredSecret = process.env.ADMIN_DASHBOARD_SECRET
  if (!configuredSecret) {
    // Refuse to serve anything rather than run unprotected — a dashboard
    // endpoint with no secret configured is worse than one that's simply
    // down, since anyone could otherwise read site-wide usage data.
    res.status(500).json({ error: 'Admin dashboard not configured' })
    return
  }

  // Peeked, not incremented — a legitimate admin's own requests (including
  // this very one, if it turns out to be valid) must never count toward the
  // lockout, only actual wrong guesses do (see AUTH_FAIL_KEY's own comment).
  const currentFailCount = await kvGetRaw<number>(AUTH_FAIL_KEY)
  if (currentFailCount !== undefined && currentFailCount > AUTH_FAIL_LIMIT) {
    res.status(429).json({ error: 'rate_limited', message: '嘗試次數過多，請稍後再試' })
    return
  }

  const providedSecretHeader = req.headers?.['x-admin-secret']
  const providedSecret = typeof providedSecretHeader === 'string' ? providedSecretHeader : undefined
  if (!providedSecret || !secretsMatch(providedSecret, configuredSecret)) {
    kvIncr(AUTH_FAIL_KEY, AUTH_FAIL_WINDOW_SECONDS)
    kvLogEvent<AuthLogEntry>(AUTH_LOG_KEY, { timestamp: new Date().toISOString(), outcome: 'fail' }, AUTH_LOG_MAX_ENTRIES)
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  kvLogEvent<AuthLogEntry>(AUTH_LOG_KEY, { timestamp: new Date().toISOString(), outcome: 'success' }, AUTH_LOG_MAX_ENTRIES)

  const daysParam = req.query?.days
  const requestedDays = typeof daysParam === 'string' ? parseInt(daysParam, 10) : DEFAULT_HISTORY_DAYS
  const days = Number.isInteger(requestedDays) && requestedDays > 0 ? Math.min(requestedDays, MAX_HISTORY_DAYS) : DEFAULT_HISTORY_DAYS
  const dates = lastNDates(days)

  // One batched MGET across every (endpoint, date) pair instead of one
  // kvGetRaw call per pair — up to 3 * 60 = 180 individual Upstash REST
  // round trips for a single dashboard load otherwise.
  const allKeys = ENDPOINTS.flatMap(({ rule }) => dates.map((date) => globalCounterKey(rule.endpoint, date)))
  const [allCounts, authLog] = await Promise.all([kvMGetRaw<number>(allKeys), kvGetLog<AuthLogEntry>(AUTH_LOG_KEY, AUTH_LOG_MAX_ENTRIES)])

  let cursor = 0
  const series = ENDPOINTS.map(({ label, rule }) => {
    const counts = allCounts.slice(cursor, cursor + dates.length)
    cursor += dates.length
    return {
      endpoint: rule.endpoint,
      label,
      globalPerDay: rule.globalPerDay,
      history: dates.map((date, i) => ({ date, count: counts[i] ?? 0 })),
    }
  })

  res.status(200).json({ series, authLog })
}
