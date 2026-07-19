<template>
  <aside class="map-panel" aria-label="地圖檢視">
    <DayTabs
      class="map-panel__day-tabs"
      :columns="columns"
      :focused-column-id="focusedColumnId"
      :editable="editable"
      @focus-column="onFocusColumn"
      @add="emit('add')"
      @delete="onDeleteColumn"
    />
    <div ref="mapEl" class="map-panel__canvas" />
    <div class="map-panel__preview">
      <div class="map-panel__preview-row">
        <template v-for="(place, index) in focusedPlaces" :key="place.id">
          <AppIcon v-if="index > 0" class="map-panel__preview-arrow" name="chevron-left" :size="12" />
          <button
            type="button"
            class="map-panel__preview-card"
            :class="{ 'map-panel__preview-card--selected': selectedPlaceId === place.id }"
            @click="emit('select', place.id)"
          >
            <span class="map-panel__preview-order" :style="{ background: dayColorForColumnId(place.columnId) }">{{
              focusedPlaceIds.indexOf(place.id) + 1
            }}</span>
            <span class="map-panel__preview-name">{{ place.name }}</span>
          </button>
        </template>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
// Free/open-source map stack: Leaflet + OpenStreetMap tiles, no API key or
// billing account required. The "vue-leaflet" package in package.json turned
// out to be an empty/abandoned shell (no exported components at all — not to
// be confused with the real @vue-leaflet/vue-leaflet), so this drives the
// core `leaflet` library directly instead of through a wrapper.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { ref } from 'vue'
import { cityFromDestination, dayColorForIndex } from '../../data/generateTrip'
import { geocodeCity } from '../../data/geocode'
import type { Place, TripColumn } from '../../types'
import AppIcon from '../ui/AppIcon.vue'
import DayTabs from './DayTabs.vue'

const props = defineProps<{
  places: Place[]
  focusedPlaceIds: string[]
  selectedPlaceId: string | null
  destination: string
  columns: TripColumn[]
  focusedColumnId: string
  // Explore templates are read-only (no day add/remove) — only the real trip
  // board opts in to showing the stepper here.
  editable?: boolean
}>()

const emit = defineEmits<{
  select: [placeId: string]
  'focus-column': [columnId: string]
  add: []
  delete: [columnId: string]
}>()

// Simplified stand-in for a draggable bottom sheet (like chicTrip's) — this
// app's kanban drag-reorder is already known to be fragile around
// programmatic scrolling (see addDay() in TripBoardPage.vue), so a real
// swipe-to-expand sheet layered on top risked the same class of gesture
// conflict. The existing 看板/地圖 toggle in the page header already gets
// back to the board, so this preview doesn't need its own expand control.
const focusedPlaces = computed(() =>
  props.focusedPlaceIds
    .map((id) => props.places.find((place) => place.id === id))
    .filter((place): place is Place => place !== undefined),
)

function onFocusColumn(columnId: string) {
  emit('focus-column', columnId)
}

function onDeleteColumn(columnId: string) {
  emit('delete', columnId)
}

const mapEl = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null
let routeLine: L.Polyline | null = null
const markers = new Map<string, L.Marker>()

// Sentinel for "not geocoded yet" — matches the 0,0 placeholder generateTrip
// and the trips store write before the background Nominatim lookup resolves.
function hasCoords(place: Place): boolean {
  return place.lat !== 0 || place.lng !== 0
}

// Pins are colored by which day they belong to, not by category — category
// stays a card-only concept, since telling days apart is what actually
// matters when scanning the map.
function dayColorForColumnId(columnId: string): string {
  const index = props.columns.findIndex((column) => column.id === columnId)
  return dayColorForIndex(index === -1 ? 0 : index)
}

// getTooltip()/getElement() only return something once the tooltip has
// actually mounted into the DOM (i.e. after the marker is on the map), so
// this is safe to call right after addTo() but not before.
function applyTooltipColor(marker: L.Marker, color: string) {
  marker.getTooltip()?.getElement()?.style.setProperty('--trip-map-pin-label-color', color)
}

function buildIcon(place: Place, order: number | null): L.DivIcon {
  const classes = [
    'trip-map-pin',
    props.selectedPlaceId === place.id ? 'trip-map-pin--selected' : '',
    props.focusedPlaceIds.length > 0 && order === null ? 'trip-map-pin--dim' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const color = dayColorForColumnId(place.columnId)

  // SVG text with dominant-baseline: central, not an HTML <span> — a plain
  // span centered via position:absolute + transform only centers its *box*;
  // the glyph's ink inside that box still sits off-center by an amount that
  // depends on the font's own ascent/descent metrics, which vary by
  // platform (this shipped once already eyeballed as "centered" against one
  // desktop browser's fallback font, then looked off-center again on
  // mobile). dominant-baseline positions against the font's real vertical
  // metrics instead of guessing a fixed pixel nudge, so it holds up across
  // whatever font each platform actually renders with.
  const orderHtml = order
    ? `<svg class="trip-map-pin__order" viewBox="0 0 20 20" aria-hidden="true"><text x="10" y="10" text-anchor="middle" dominant-baseline="central">${order}</text></svg>`
    : ''

  return L.divIcon({
    className: '',
    html: `<span class="${classes}"><span class="trip-map-pin__dot" style="background:${color}"></span>${orderHtml}</span>`,
    iconSize: [32, 32],
    // Centered, not bottom-anchored — the marker is a dot marking the exact
    // point, not a teardrop pin whose tip should touch down on it.
    iconAnchor: [16, 16],
  })
}

function syncMarkers() {
  if (!map) return

  const seen = new Set<string>()
  for (const place of props.places) {
    if (!hasCoords(place)) continue
    seen.add(place.id)

    const focusIndex = props.focusedPlaceIds.indexOf(place.id)
    const order = focusIndex === -1 ? null : focusIndex + 1
    const icon = buildIcon(place, order)
    const color = dayColorForColumnId(place.columnId)

    const existing = markers.get(place.id)
    if (existing) {
      existing.setLatLng([place.lat, place.lng])
      existing.setIcon(icon)
      if (order !== null) existing.openTooltip()
      else existing.closeTooltip()
      // A place can move to a different day (its columnId changes) without
      // its marker being recreated, so the tooltip color needs refreshing
      // on every sync, not just once at creation.
      applyTooltipColor(existing, color)
    } else {
      const marker = L.marker([place.lat, place.lng], { icon, title: place.name })
      // Permanent name label, not just a numbered dot — but only for the
      // focused day's places. Labeling every pin at once (including dimmed
      // other-day places still on screen) would clutter a 10+ place trip.
      marker.bindTooltip(place.name, {
        permanent: true,
        direction: 'top',
        offset: [0, -10],
        className: 'trip-map-pin__label',
      })
      marker.on('click', () => emit('select', place.id))
      // Binding a permanent tooltip wires an internal listener that opens it
      // as soon as the marker is added to the map — closeTooltip() before
      // addTo() is a no-op (nothing mounted yet to close), and that listener
      // fires right after, overriding it. Must close only after adding.
      marker.addTo(map)
      if (order === null) marker.closeTooltip()
      applyTooltipColor(marker, color)
      markers.set(place.id, marker)
    }
  }

  for (const [id, marker] of markers) {
    if (!seen.has(id)) {
      marker.remove()
      markers.delete(id)
    }
  }
}

function syncRoute() {
  if (!map) return
  routeLine?.remove()
  routeLine = null

  const points = focusedPlaces.value
    .filter(hasCoords)
    .map((place): L.LatLngTuple => [place.lat, place.lng])

  if (points.length < 2) return
  const color = dayColorForColumnId(props.focusedColumnId)
  routeLine = L.polyline(points, { color, weight: 2.5, opacity: 0.85 }).addTo(map)
}

function fitTo(markerList: L.Marker[]) {
  if (!map || markerList.length === 0) return
  const bounds = L.latLngBounds(markerList.map((marker) => marker.getLatLng()))
  map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 })
}

function fitToMarkers() {
  fitTo([...markers.values()])
}

// Scoped to just the focused day, unlike fitToMarkers() above (which fits
// every pin) — switching days should pan/zoom to that day's places, not
// re-fit the whole trip every time.
function fitToFocusedMarkers() {
  fitTo(props.focusedPlaceIds.map((id) => markers.get(id)).filter((marker): marker is L.Marker => marker !== undefined))
}

function syncAll() {
  syncMarkers()
  syncRoute()
}

// Only rebuilds the icon for the marker that lost selection and the one that
// gained it, instead of syncMarkers()'s full rebuild — selecting one card
// shouldn't visibly flicker every other pin on the map.
let previousSelectedId: string | null = props.selectedPlaceId
function updateSelection() {
  if (!map) {
    previousSelectedId = props.selectedPlaceId
    return
  }
  for (const id of new Set([previousSelectedId, props.selectedPlaceId])) {
    if (!id) continue
    const marker = markers.get(id)
    const place = props.places.find((item) => item.id === id)
    if (!marker || !place) continue
    const focusIndex = props.focusedPlaceIds.indexOf(id)
    marker.setIcon(buildIcon(place, focusIndex === -1 ? null : focusIndex + 1))
  }
  previousSelectedId = props.selectedPlaceId
}

onMounted(async () => {
  if (!mapEl.value) return

  map = L.map(mapEl.value).setView([20, 0], 2)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)

  syncAll()

  if (markers.size > 0) {
    fitToMarkers()
    return
  }

  // No pins yet (places still geocoding, or none saved) — center on the
  // destination city itself so the map isn't just a blank world view. This
  // lookup shares geocode.ts's rate-limited queue with this trip's own place
  // lookups, so it can resolve well after real pins have already arrived and
  // been fitted (see the geocodedCount watch below) — re-check markers.size
  // here so a slow city lookup can't stomp an already-correct fit.
  const center = await geocodeCity(cityFromDestination(props.destination))
  if (center && map && markers.size === 0) map.setView([center.lat, center.lng], 12)
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

// Tracks only the fields that actually change what's plotted (which places
// exist, their coordinates, and which day/color they belong to) instead of
// deep-watching the whole places array — editing a place's name, notes, or
// schedule elsewhere on the page shouldn't touch the map at all.
const markerSignature = computed(() =>
  props.places.map((place) => `${place.id}:${place.lat}:${place.lng}:${place.columnId}`).join('|'),
)
// Re-fitting the viewport only makes sense when a pin newly appears (e.g. a
// background geocode resolves) — not on every signature change, since a
// place moving to a different day just needs its color refreshed, not the
// whole map re-zoomed out from under the user (e.g. mid-drag on desktop,
// where the board and map are visible side by side).
const geocodedCount = computed(() => props.places.filter(hasCoords).length)

watch(markerSignature, () => {
  syncAll()
})

watch(geocodedCount, (count, previousCount) => {
  if (count > previousCount) fitToMarkers()
})

watch(() => props.focusedPlaceIds, () => {
  syncAll()
  fitToFocusedMarkers()
})
watch(() => props.selectedPlaceId, updateSelection)
</script>
