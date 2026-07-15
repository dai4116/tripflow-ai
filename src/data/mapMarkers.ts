// Static pin layout for the read-only map preview — shared by the real trip
// board and the Explore template board so both render pins identically.
const CURATED_MARKER_POSITIONS = [
  ['25%', '28%'],
  ['64%', '36%'],
  ['41%', '63%'],
  ['22%', '70%'],
  ['35%', '31%'],
  ['57%', '24%'],
  ['50%', '30%'],
  ['44%', '44%'],
  ['31%', '58%'],
  ['76%', '66%'],
  ['52%', '41%'],
  ['68%', '52%'],
]

// Trips/templates with more places than the curated table above — spiral the
// overflow out at the golden angle so pins stay spread out and in-bounds
// instead of collapsing onto a single fallback point.
function overflowMarkerPosition(index: number) {
  const goldenAngleRad = (137.508 * Math.PI) / 180
  const angle = index * goldenAngleRad
  const radius = 12 + (index % 7) * 6
  const clamp = (value: number) => Math.min(84, Math.max(10, value))

  return {
    top: `${clamp(46 + radius * Math.sin(angle) * 0.9).toFixed(1)}%`,
    left: `${clamp(46 + radius * Math.cos(angle)).toFixed(1)}%`,
  }
}

export function markerPosition(index: number): { top: string; left: string } {
  const curated = CURATED_MARKER_POSITIONS[index]
  if (curated) {
    const [top, left] = curated

    return { top, left }
  }

  return overflowMarkerPosition(index)
}

const ROUTE_VIEWBOX = { width: 340, height: 560 }

export function buildRoutePath(focusedPlaces: { id: string }[], allPlaces: { id: string }[]): string {
  const points = focusedPlaces.map((place) => {
    const index = allPlaces.findIndex((item) => item.id === place.id)
    const position = markerPosition(index)

    return {
      x: (Number.parseFloat(position.left) / 100) * ROUTE_VIEWBOX.width,
      y: (Number.parseFloat(position.top) / 100) * ROUTE_VIEWBOX.height,
    }
  })

  if (points.length < 2) return ''

  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
}
