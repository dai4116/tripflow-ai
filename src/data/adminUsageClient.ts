const STORAGE_KEY = 'tripflow-admin-secret'

export type UsageDay = { date: string; count: number }
export type UsageSeries = { endpoint: string; label: string; globalPerDay: number; history: UsageDay[] }
// No visitor id / IP — deliberately just "when, and did it work" (see
// api/admin/usage.ts's AuthLogEntry comment).
export type AuthLogEntry = { timestamp: string; outcome: 'success' | 'fail' }
export type UsageResult = { series: UsageSeries[]; authLog: AuthLogEntry[] }
export type UsageError = 'unauthorized' | 'unconfigured' | 'unknown'

// sessionStorage, not localStorage — this is a plaintext secret (client-side
// "encryption" of it would be security theater: the decryption key would
// have to live in the same browser too, so anyone who can run JS in this
// origin can reverse it exactly the way the app does). sessionStorage
// bounds how long that plaintext sits on disk instead: it's cleared when the
// tab/browser closes, at the cost of re-entering the secret each new
// session instead of it persisting indefinitely.
export function getStoredAdminSecret(): string | undefined {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function storeAdminSecret(secret: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, secret)
  } catch {
    // sessionStorage unavailable (private mode, disabled) — the secret just
    // won't persist across reloads, not worth surfacing as an error here.
  }
}

export function clearStoredAdminSecret(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // See storeAdminSecret's own comment.
  }
}

// Talks to /api/admin/usage. Returns the parsed result, or a tagged error —
// 'unauthorized' (wrong/missing secret) is what the page uses to re-prompt
// for the secret instead of showing a generic failure state.
export async function fetchUsage(secret: string, days = 14): Promise<UsageResult | { error: UsageError }> {
  try {
    const response = await fetch(`/api/admin/usage?days=${days}`, {
      headers: { 'X-Admin-Secret': secret },
    })
    if (response.status === 401) return { error: 'unauthorized' }
    if (response.status === 500) return { error: 'unconfigured' }
    if (!response.ok) return { error: 'unknown' }
    return (await response.json()) as UsageResult
  } catch {
    return { error: 'unknown' }
  }
}
