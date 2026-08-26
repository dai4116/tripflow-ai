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
