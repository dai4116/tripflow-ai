import { Redis } from '@upstash/redis'

// Minimal Upstash Redis cache helper — bounded round trip, never throws,
// degrades to "always miss" when KV_REST_API_URL/KV_REST_API_TOKEN aren't
// set (e.g. local dev) or Redis itself is having a bad moment. Extracted
// here as the second consumer of this exact shape shows up (place-photo.ts,
// alongside placesVerify.ts's own near-identical inline version) — kept as a
// separate, additive module rather than refactoring placesVerify.ts onto it,
// so already-verified, already-in-production caching logic isn't touched for
// no user-facing benefit.
const kv =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
    : null

// Bounds one KV round trip so a slow/hung Upstash response degrades to
// "miss" instead of adding its own unbounded latency on top of whatever the
// caller does next on a miss.
const KV_TIMEOUT_MS = 3000

function withKvTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('KV timeout')), KV_TIMEOUT_MS)
  })
  // .finally, not a bare clearTimeout after the race — the loser (whichever
  // side didn't settle the race) is still a live timer/pending promise until
  // this fires, so without it the losing setTimeout keeps the event loop busy
  // for up to KV_TIMEOUT_MS past the point nothing is listening for it.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Wrapped rather than a bare T so a genuine cached negative (`{v: null}`, for
// callers whose T includes null) is distinguishable from "not in KV at all"
// (a bare `null` response from redis.get) — same distinction a plain Map
// gets for free from `Map.get` returning `undefined` on a miss vs an
// explicit `null`/`[]` value.
type KvEntry<T> = { v: T }

export async function kvGet<T>(key: string): Promise<T | undefined> {
  if (!kv) return undefined
  try {
    const entry = await withKvTimeout(kv.get<KvEntry<T>>(key))
    return entry === null ? undefined : entry.v
  } catch (error) {
    console.error('[kv] read failed, falling back to miss', error)
    return undefined
  }
}

// Fire-and-forget — the caller already has its result; a slow or failed
// cache write shouldn't hold up (or fail) the request that produced it.
export function kvSet<T>(key: string, value: T, ttlSeconds: number): void {
  if (!kv) return
  kv.set<KvEntry<T>>(key, { v: value }, { ex: ttlSeconds }).catch((error) => {
    console.error('[kv] write failed', error)
  })
}

// Atomic counter for rate limiting — INCR (not read-then-write) so concurrent
// requests can't race each other into under-counting. Returns undefined on
// any failure or when KV isn't configured, same "degrade to unlimited"
// contract as kvGet/kvSet — a caller checking a limit must treat undefined as
// "can't enforce this, allow the request" rather than blocking on it.
//
// TTL is only set on the call that creates the key (result === 1) — setting
// it on every call would keep sliding the window forward and the counter
// would never actually expire. The gap between INCR and EXPIRE isn't atomic
// (no Lua script — not worth the complexity here), so a crash in that gap
// leaves a key with no TTL; worst case that makes this one counter stricter
// than intended (it never resets) until manually cleared, never looser.
export async function kvIncr(key: string, ttlSeconds: number): Promise<number | undefined> {
  if (!kv) return undefined
  try {
    const count = await withKvTimeout(kv.incr(key))
    if (count === 1) {
      kv.expire(key, ttlSeconds).catch((error) => {
        console.error('[kv] failed to set expiry after incr', error)
      })
    }
    return count
  } catch (error) {
    console.error('[kv] incr failed, falling back to unlimited', error)
    return undefined
  }
}
