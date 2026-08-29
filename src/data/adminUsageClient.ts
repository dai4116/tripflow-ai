const STORAGE_KEY = 'tripflow-admin-secret'

export type UsageDay = { date: string; count: number }
export type UsageSeries = { endpoint: string; label: string; globalPerDay: number; history: UsageDay[] }
export type UsageResult = { series: UsageSeries[] }
export type UsageError = 'unauthorized' | 'unconfigured' | 'unknown'

export function getStoredAdminSecret(): string | undefined {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function storeAdminSecret(secret: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, secret)
  } catch {
    // localStorage unavailable (private mode, disabled) — the secret just
    // won't persist across reloads, not worth surfacing as an error here.
  }
}

export function clearStoredAdminSecret(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
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
