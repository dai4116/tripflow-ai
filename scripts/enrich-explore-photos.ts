// One-time enrichment: looks up a Google Places photo for each hand-curated
// Explore template place (src/data/exploreTrips.ts) and writes the result
// back into that file as a `photoRef` field, same shape as the one AI-generated
// trips get from api/_lib/placesVerify.ts at generation time. Explore places
// never go through that live pipeline (they're a static fixture with
// hand-typed lat/lng, not AI-generated), so without this they'd fall back to
// the decorative gradient forever.
//
// Run once, locally: node --env-file=.env --experimental-strip-types scripts/enrich-explore-photos.ts
// Safe to re-run — it just overwrites whatever photoRef it finds this time.
//
// Uses each place's own hand-curated lat/lng as the location bias (tighter
// and more accurate than a shared city-center bias would be, especially for
// day-trip suburbs), rather than reusing geocodeCityCenter per template.
//
// Reads exploreTrips.ts as plain text (regex-extracted) instead of importing
// it as a module: that file's own `from './generateTrip'` import omits the
// extension (fine for Vite's bundler resolution, but Node's native ESM
// loader — which this script runs under, for TS-stripping without a bundler
// — requires one). Not worth changing app source just to satisfy a one-off
// script; the patch step below already treats the file as text anyway.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyPlace, type GeoPoint } from '../api/_lib/placesVerify.ts'

const apiKey = process.env.GOOGLE_PLACES_API_KEY
if (!apiKey) {
  console.error('Missing GOOGLE_PLACES_API_KEY (expected in .env, loaded via --env-file=.env)')
  process.exit(1)
}

const filePath = fileURLToPath(new URL('../src/data/exploreTrips.ts', import.meta.url))
const sourceText = readFileSync(filePath, 'utf8')

type SourcePlace = { id: string; tripId: string; name: string; lat: number; lng: number }
const PLACE_LINE_RE = /id:\s*'([^']+)'.*?tripId:\s*'([^']+)'.*?name:\s*'([^']+)'.*?lat:\s*(-?\d+(?:\.\d+)?).*?lng:\s*(-?\d+(?:\.\d+)?)/
const explorePlaces: SourcePlace[] = []
for (const line of sourceText.split('\n')) {
  const match = PLACE_LINE_RE.exec(line)
  if (!match) continue
  const [, id, tripId, name, lat, lng] = match
  explorePlaces.push({ id, tripId, name, lat: Number(lat), lng: Number(lng) })
}
console.log(`Parsed ${explorePlaces.length} places from exploreTrips.ts`)

type Result = { id: string; status: 'ok' | 'no-photo' | 'no-match'; photoRef?: string }
const results: Result[] = []

for (const place of explorePlaces) {
  const bias: GeoPoint = { lat: place.lat, lng: place.lng }
  const hit = await verifyPlace(apiKey, [place.name], bias)

  if (!hit) {
    console.log(`[no-match] ${place.id} — "${place.name}"`)
    results.push({ id: place.id, status: 'no-match' })
    continue
  }
  if (!hit.photoRef) {
    console.log(`[no-photo] ${place.id} — matched "${hit.name}", but no photo on record`)
    results.push({ id: place.id, status: 'no-photo' })
    continue
  }
  console.log(`[ok]       ${place.id} — matched "${hit.name}"`)
  results.push({ id: place.id, status: 'ok', photoRef: hit.photoRef })
}

const lines = sourceText.split('\n')
let patchedCount = 0
const patchedLines = lines.map((line) => {
  const result = results.find((r) => r.photoRef && line.includes(`id: '${r.id}',`))
  if (!result) return line
  patchedCount++
  // Every place entry here is a single-line object literal ending in
  // `imageGradient: gradientFor(N) }` (optionally with a trailing comma if
  // it's not the array's last element) — append photoRef as the last
  // property, right before that closing brace.
  return line.replace(/\s*\}(,?)\s*$/, `, photoRef: '${result.photoRef}' }$1`)
})
writeFileSync(filePath, patchedLines.join('\n'))

const ok = results.filter((r) => r.status === 'ok').length
const noPhoto = results.filter((r) => r.status === 'no-photo').length
const noMatch = results.filter((r) => r.status === 'no-match').length
console.log(`\n${ok} ok, ${noPhoto} matched-but-no-photo, ${noMatch} no-match — patched ${patchedCount} lines in exploreTrips.ts`)
