// Combines an optional caller-supplied AbortSignal with a timeout into one
// signal that fires on whichever happens first — shared by every src/data/
// fetch client that needs to bound a request without waiting on the server
// forever (placesSearchClient.ts, placesAutocompleteClient.ts). Caller must
// call `clear()` once the fetch settles (success or failure) to release the
// timer, or it keeps counting down uselessly until it fires on its own.
export function withTimeout(timeoutMs: number, externalSignal?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const timeoutController = new AbortController()
  const timer = window.setTimeout(() => timeoutController.abort(), timeoutMs)
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutController.signal]) : timeoutController.signal
  return { signal, clear: () => window.clearTimeout(timer) }
}
