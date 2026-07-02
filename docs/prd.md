# TripFlow AI PRD

## 1. Product Overview

TripFlow AI is an AI-powered travel workspace that helps users plan trips with Kanban boards and map visualization.

It is not a travel blog, booking website, or simple itinerary generator.

The product concept is:

Travel planning should work like project management.

Users can:
- Create a trip
- Enter destination, days, budget, travel preferences, and places to avoid
- Generate an itinerary with AI
- Turn the itinerary into a Kanban board
- Drag place cards between days
- View all places on a map
- Click a card to view or edit place details

## 2. Product Positioning

TripFlow AI = Wanderlog-like travel planning + Linear-like workspace + Kanban + AI + map sync.

The main portfolio goal is to demonstrate:
- Vue 3 project architecture
- TypeScript
- Pinia state management
- Vue Router
- SCSS component styling
- Kanban drag and drop
- Map marker synchronization
- AI-generated structured itinerary data
- Clean SaaS-style UI

## 3. MVP Pages

### Landing Page

Route:

/

Purpose:
Introduce the product and guide users to start planning.

Must include:
- Header
- Hero section
- CTA buttons
- Product preview mockup
- Feature highlights

### Dashboard Page

Route:

/dashboard

Purpose:
Show user's trip overview.

Must include:
- Sidebar
- Stats cards
- Recent trips
- Create trip CTA
- Empty state if no trips exist

### Create Trip Page

Route:

/trips/new

Purpose:
Allow users to create a trip and generate itinerary with AI.

Must include:
- Destination input
- Days input
- Budget input
- Travelers input
- Travel style selector
- Preferences chips
- Places to avoid textarea
- Generate with AI button

### Trip Board Page

Route:

/trips/:tripId

Purpose:
Main product screen.

Must include:
- Sidebar
- Trip header
- Kanban board
- Columns: Planning, Day 1, Day 2, Day 3, Done
- Place cards
- Map panel
- Place detail drawer

## 4. MVP Features

Required:
- Static Landing Page
- Dashboard layout
- Create Trip form
- Trip Board layout
- Mock trip data
- Pinia store
- LocalStorage persistence
- Kanban drag and drop
- Map markers with Leaflet
- Card and marker highlight sync
- Detail drawer
- Mock AI itinerary generation
- Basic responsive layout

Optional if time allows:
- Real AI API
- Route polyline
- Budget chart
- AI regenerate day

## 5. Out of Scope for v1

Do not implement these in v1:
- Login
- Register
- Backend database
- Supabase
- Google OAuth
- Google Maps Places API
- Real navigation
- Route optimization
- Multi-user collaboration
- Payment
- Reviews
- Share link
- Calendar view
- Notifications
- Multi-language support

## 6. Main User Flow

1. User opens Landing Page
2. User clicks Start Planning
3. User enters Dashboard
4. User creates a new trip
5. User enters destination, days, budget, preferences, and places to avoid
6. User clicks Generate with AI
7. App creates a trip from AI or mock data
8. User enters Trip Board
9. User drags place cards between days
10. Map markers update based on current places
11. User clicks a card or marker
12. Detail drawer opens

## 7. Data Models

### Trip

```ts
export type Trip = {
  id: string
  title: string
  destination: string
  startDate?: string
  days: number
  budget?: number
  travelers?: number
  preferences: string[]
  avoidPlaces?: string
  pace: TripPace
  columns: TripColumn[]
  createdAt: string
  updatedAt: string
}

TripColumn
export type TripColumn = {
  id: string
  title: string
  type: 'planning' | 'day' | 'done'
  dayNumber?: number
  placeIds: string[]
}
Place
export type Place = {
  id: string
  tripId: string
  name: string
  category: PlaceCategory
  estimatedTime: number
  estimatedCost: number
  address: string
  lat: number
  lng: number
  reason?: string
  notes?: string
  checklist: ChecklistItem[]
  createdAt: string
  updatedAt: string
}
ChecklistItem
export type ChecklistItem = {
  id: string
  title: string
  completed: boolean
}
TripPace
export type TripPace = 'relaxed' | 'balanced' | 'packed'
PlaceCategory
export type PlaceCategory =
  | 'food'
  | 'cafe'
  | 'shopping'
  | 'culture'
  | 'nature'
  | 'museum'
  | 'transport'
  | 'hotel'
  | 'activity'
  | 'other'
8. Store Requirement

Use Pinia as the main source of truth.

The trip store should manage:

trips
activeTripId
places
selectedPlaceId
highlightedPlaceId
loading state
error state

Core actions:

createTrip
updateTrip
deleteTrip
setActiveTrip
addPlace
updatePlace
deletePlace
movePlace
selectPlace
highlightPlace
clearHighlight
saveToStorage
loadFromStorage
9. Important Development Rule

Do not build all features at once.

Always implement in small steps:

Static layout
Mock data
Store
Interactions
Map
AI

Every task should keep the project clean, typed, and maintainable.