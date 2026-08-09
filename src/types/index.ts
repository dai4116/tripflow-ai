export type TripPace = 'relaxed' | 'balanced' | 'packed'

export type PlaceCategory =
  | 'food'
  | 'attraction'
  | 'shopping'
  | 'stay'
  | 'transport'
  | 'other'

export type PlaceScheduleMode = 'duration' | 'departure'

export type TravelMode = 'driving' | 'walking' | 'cycling' | 'manual'

export type TravelToNext = {
  // Which place this describes travel to — lets consumers detect a stale
  // entry after reordering (the stored place is no longer actually next)
  // without needing to proactively scrub every place on every reorder.
  toPlaceId: string
  mode: TravelMode
  durationMin: number
  distanceKm?: number
  // True when this was computed by fillMissingTravelTimes rather than
  // chosen by the user via the picker — lets stale-entry cleanup tell
  // "safe to silently replace with a new guess" apart from "user picked
  // this deliberately, leave it alone" (see trips.ts).
  auto?: boolean
}

export type TripColumn = {
  id: string
  title: string
  dayNumber: number
  placeIds: string[]
  // Which of Trip.cities this day belongs to, for a multi-destination trip
  // (e.g. 荷蘭 3 天 + 比利時 2 天) — undefined for every single-destination
  // trip, including all trips created before this field existed. Assigned
  // once at creation from CreateTripInput.cities' own per-city day counts
  // (see generateTrip.ts) and from then on just inherited by addDay/
  // removeDay (TripBoardPage.vue) like dayNumber already is, so "which day
  // maps to which city" can never drift out of sync with the column list
  // itself — there's no separate segments/day-count list to keep in sync.
  cityId?: string
}

// One destination within a multi-city trip (e.g. 荷蘭 3 天 + 比利時 2 天 +
// 法國 5 天) — see TripColumn.cityId. Absent (Trip.cities undefined) for
// every single-destination trip; the ordinary destination/destinationPlaceId/
// destinationLat/destinationLng fields on Trip keep meaning exactly what they
// mean today either way (see CreateTripInput.cities' own comment for why).
export type TripCity = {
  id: string
  destination: string
  destinationPlaceId?: string
  destinationLat?: number
  destinationLng?: number
}

export type TripSummary = {
  id: string
  title: string
  destination: string
  days: number
  placeCount: number
  color: string
  // Google Places photo resource name for the trip's chosen cover photo (see
  // api/_lib/placesVerify.ts's getPlaceCoverPhotos), picked by the user in
  // TripSettingsModal.vue from candidates fetched for destinationPlaceId.
  // Resolved to an actual image via /api/place-photo, same as Place.photoRef.
  // Takes priority over coverImage below when both are set (see TripCard.vue/
  // DashboardPage.vue/TripSettingsModal.vue) — it reflects a deliberate user
  // pick, coverImage is just a starting default. Absent falls back to
  // coverImage, then TrailCoverArt.vue's illustration.
  coverPhotoRef?: string
  // A plain direct image URL — unlike coverPhotoRef, not a Google Places
  // reference needing the /api/place-photo proxy to hide an API key. Set on
  // Explore templates as their curated cover (see exploreTrips.ts) and
  // copied onto the real Trip stores/trips.ts's copyTemplateTrip() creates,
  // so a copied trip keeps looking like its template until the user picks
  // their own photo via coverPhotoRef.
  coverImage?: string
}

export type Trip = TripSummary & {
  dateRange: string
  // ISO date (YYYY-MM-DD) for Day 1 — lets each column compute its own
  // calendar date instead of just a "Day N" label. Optional because
  // AI-generated trips don't collect a start date yet.
  startDate?: string
  // Google Place resource id + coordinates for the resolved destination —
  // present only when the user picked a suggestion from Google Places
  // Autocomplete on trip creation (see DestinationAutocomplete.vue) rather
  // than just typing free text. Selecting a suggestion is optional, so these
  // are always set together and absent together (no suggestion picked, the
  // Places API key is unset, or the Details lookup failed). Lets the cover
  // photo picker (TripSettingsModal.vue, backed by getPlaceCoverPhotos) fetch
  // candidates directly instead of re-parsing `destination`'s free-text
  // string.
  destinationPlaceId?: string
  destinationLat?: number
  destinationLng?: number
  preferences: string[]
  pace: TripPace
  columns: TripColumn[]
  // See TripColumn.cityId. Undefined for every single-destination trip.
  cities?: TripCity[]
}

// A curated sample itinerary shown on the Explore page — same shape as Trip
// minus the date fields (templates aren't scheduled), plus a one-line pitch.
// imageGradient lives only here, not on TripSummary/Trip — real trips show a
// cover photo or TrailCoverArt.vue's illustration instead (see TripCard.vue's
// showFallbackArt), but templates keep their own curated decorative gradient
// (see exploreTrips.ts) since they're never assigned a coverPhotoRef.
export type ExploreTemplate = Omit<Trip, 'dateRange' | 'startDate'> & {
  tagline: string
  imageGradient: string
}

// TripSettingsModal.vue's save emit — shared with TripBoardPage.vue's
// onSaveTripSettings handler so the two don't keep an inline copy of the same
// shape in sync by hand.
export type TripSettingsSavePayload = {
  title: string
  startDate: string
  endDate: string
  coverPhotoRef?: string
}

export type Place = {
  id: string
  tripId: string
  name: string
  category: PlaceCategory
  estimatedTime: number
  address: string
  lat: number
  lng: number
  description: string
  // English/local-language name used for the initial geocode lookup instead
  // of `name` (which is Traditional Chinese by design) — see PlaceSuggestion
  // in generateTrip.ts. Only set for AI-suggested places.
  geocodeQuery?: string
  // Retried if geocodeQuery's lookup comes back empty — see PlaceSuggestion.
  geocodeQueryAlt?: string
  // Manual arrival-time override ('HH:mm'). When unset, the effective
  // arrival time cascades from the place before it — see computeArrivalTimes.
  arrivalTime?: string
  // The two values are stored independently. scheduleMode only chooses which
  // one represents the place on its card and drives the following arrival.
  scheduleMode?: PlaceScheduleMode
  departureTime?: string
  columnId: string
  // Google Places photo resource name (e.g. "places/xxx/photos/yyy"), present
  // when the place was verified server-side and Google has a photo on record
  // — see api/_lib/placesVerify.ts. Resolved to an actual image URL via
  // /api/place-photo (never fetched directly; that endpoint keeps the
  // Places API key server-side). Absent falls back to a generic placeholder
  // — see usePlacePhoto.ts.
  photoRef?: string
  // Travel from this place to whichever place follows it in the same day —
  // absent until calculated (see routing.ts / trips store's auto-fill).
  travelToNext?: TravelToNext
  // Google Places id, present when the place came from a verified Google
  // Places result (AddPlaceModal.vue's search, or server-side AI
  // verification) — lets stores/trips.ts's addPlace reject a duplicate add
  // of the same real-world place. Absent for places added without Google
  // verification (e.g. AskAiPanel.vue's chat-suggested places).
  placeId?: string
  // Set on the "抵達機場"/"前往機場" cards generateTrip.ts's addFlightPlace
  // creates for a known flight time — they start at lat/lng 0,0 on purpose
  // (a guessed airport name risks a wrong-but-confident pin), and this tells
  // stores/trips.ts's geocodeNewPlaces to leave them alone instead of
  // falling back to its generic Nominatim-by-name path, which would try to
  // geocode a literal phrase like "抵達機場". Cleared by updatePlace once the
  // user renames the card to something specific (e.g. "桃園國際機場第二航廈")
  // — that's no longer a guess, so it's worth an actual geocode attempt.
  skipGeocode?: boolean
}

export type CreateTripInput = {
  destination: string
  // See Trip's identical fields — threaded straight through from
  // CreateTripPage.vue's DestinationAutocomplete selection, unset when the
  // user just typed free text.
  destinationPlaceId?: string
  destinationLat?: number
  destinationLng?: number
  // ISO dates (YYYY-MM-DD) — trip length is derived from the gap between them
  // rather than collected as its own field.
  startDate: string
  endDate: string
  // A single selected style archetype (e.g. 精準規劃/自在慢旅), held as a
  // 0-or-1-element array for a stable field type rather than a bare
  // `string | undefined` — see paceForTravelStyles in generateTrip.ts, which
  // reads just the first element.
  travelStyle: string[]
  // Free-text catch-all for anything the structured fields don't cover —
  // places to avoid, but just as often a positive request (dietary needs, "want
  // a beach day", traveling with kids) — see api/_lib/tripGen.ts's prompt
  // for why it's framed neutrally rather than as an exclusion list.
  additionalNotes: string
  preferences: string[]
  // Optional flight-aware scheduling, both 'HH:mm' local time (no timezone
  // conversion — see CreateTripPage.vue's helper text). When set,
  // generateTrip.ts narrows day 1's / the last day's active-hours window to
  // fit the shortened time (see windowForFlightDay) AND prepends/appends a
  // real "抵達機場"/"前往機場" Place card carrying the time as its manual
  // arrivalTime — that card is what actually drives the schedule cascade
  // (via computeArrivalTimes' existing manual-arrival handling) and gets the
  // existing overlap warning "for free" if the day runs too late for the
  // flight. Not stored anywhere else on the trip — editing it afterward
  // means editing that place card directly, same as any other place.
  arrivalTime?: string
  departureTime?: string
  // Present only when CreateTripPage.vue's form has more than one
  // destination row — every entry, including the first (whose fields are
  // duplicated onto this type's own destination/destinationPlaceId/
  // destinationLat/destinationLng above, since the AI generation pipeline
  // — aiTripClient.ts/plan-trip-zones.ts/generate-trip-day.ts — doesn't know
  // how to split a request per city segment yet and needs ONE real
  // destination string to search against; see that pipeline's own trip-
  // generation-per-day-requests design for why per-day requests are actually
  // well-suited to eventually reading this instead). generateTrip.ts uses
  // this to label the trip and tag each day column with the city it belongs
  // to (see TripColumn.cityId) — until the generation pipeline is updated to
  // match, every day's AI-suggested places still come from the first city
  // only, regardless of how many cities are listed here.
  cities?: {
    destination: string
    destinationPlaceId?: string
    destinationLat?: number
    destinationLng?: number
    days: number
  }[]
}
