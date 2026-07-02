```md
# TripFlow AI Development Plan

## Development Principle

Build this project in small, controlled steps.

Do not implement AI, map, drag and drop, and full UI at the same time.

The correct order is:

1. Project setup
2. Router and layout
3. Static pages
4. Mock data and types
5. Pinia store
6. Kanban interaction
7. Map integration
8. AI generation
9. Responsive layout
10. README and deployment

## Week 1: Project Structure and Static UI

### Day 1: Project Setup

Goal:
Create the project foundation.

Tasks:
- Set up Vue 3 + TypeScript + Vite
- Install Vue Router
- Install Pinia
- Install SCSS
- Create folder structure
- Create router
- Create empty pages
- Create app layout
- Create global styles

Do not:
- Add AI
- Add map
- Add drag and drop
- Add complex UI

### Day 2: Base UI Components

Goal:
Create reusable UI components.

Tasks:
- BaseButton
- BaseCard
- BaseInput
- BaseSelect
- BaseTextarea
- BaseBadge
- BaseDrawer
- BaseEmptyState

Do not:
- Over-engineer variants
- Add external UI libraries

### Day 3: Landing Page

Goal:
Create static Landing Page based on design reference.

Tasks:
- Header
- Hero section
- CTA buttons
- Product preview mockup
- Feature highlights
- Responsive layout

### Day 4: Dashboard Page

Goal:
Create static Dashboard Page.

Tasks:
- Sidebar layout
- Stats cards
- Recent trips
- Create trip CTA
- Empty state

### Day 5: Create Trip Page

Goal:
Create static Create Trip form.

Tasks:
- Destination input
- Days input
- Budget input
- Travelers input
- Travel style selector
- Preferences chips
- Places to avoid textarea
- Generate with AI button

### Day 6-7: Trip Board Static UI

Goal:
Create the main Trip Board page without interactions.

Tasks:
- Sidebar
- Trip header
- Kanban board
- Columns
- Place cards
- Fake map panel
- Detail drawer static UI

Do not:
- Add real drag and drop
- Add Leaflet
- Add AI

## Week 2: Data and Kanban

### Day 8: Types and Mock Data

Goal:
Create TypeScript models and mock data.

Tasks:
- Trip type
- TripColumn type
- Place type
- ChecklistItem type
- mockTrips
- mockPlaces

### Day 9: Pinia Store

Goal:
Create trip store.

Tasks:
- state
- getters
- basic actions
- active trip
- selected place
- highlighted place

### Day 10: LocalStorage

Goal:
Persist trip data.

Tasks:
- saveToStorage
- loadFromStorage
- initialize store on app load

### Day 11-12: Kanban Drag and Drop

Goal:
Implement drag and drop with vue-draggable-plus.

Tasks:
- Same-column sorting
- Cross-column moving
- Update column placeIds
- Keep store as source of truth

### Day 13: Detail Drawer

Goal:
Make detail drawer interactive.

Tasks:
- Click card to open drawer
- Edit place name
- Edit notes
- Edit estimated time
- Edit estimated cost
- Update store

### Day 14: Cleanup

Goal:
Refactor and test Week 2 features.

Tasks:
- Remove duplicate logic
- Improve types
- Fix layout bugs

## Week 3: Map and AI

### Day 15-16: Leaflet Map

Goal:
Integrate real map.

Tasks:
- Install and set up Leaflet
- Show markers from places
- Fit bounds
- Basic marker popup

### Day 17: Card and Marker Sync

Goal:
Synchronize selected card and map marker.

Tasks:
- Click card highlights marker
- Click marker highlights card
- Store highlightedPlaceId
- Smooth UI feedback

### Day 18: Mock AI Flow

Goal:
Build AI generation flow with mock JSON.

Tasks:
- Generate itinerary button
- Mock AI response
- Transform response into Trip / Columns / Places
- Navigate to Trip Board

### Day 19-20: Real AI API Optional

Goal:
Add real AI only if the app is stable.

Tasks:
- Environment variables
- API request
- JSON parsing
- Fallback mock response

### Day 21: Integration Test

Goal:
Make sure full flow works.

Flow:
Create Trip → Generate Itinerary → Trip Board → Drag Card → Map Update → Drawer Edit

## Week 4: Polish and Portfolio

### Day 22-23: Responsive Layout

Goal:
Make pages usable on tablet and mobile.

Tasks:
- Sidebar collapse
- Mobile Board / Map tabs
- Drawer full screen on mobile

### Day 24: Loading and Empty States

Goal:
Improve product quality.

Tasks:
- Loading state
- Skeleton
- Empty state
- Error state
- Toast message

### Day 25: UI Polish

Goal:
Improve visual quality.

Tasks:
- Hover states
- Transitions
- Card shadow
- Button states
- Spacing consistency

### Day 26: Code Cleanup

Goal:
Improve maintainability.

Tasks:
- Extract composables
- Clean types
- Remove dead code
- Check naming consistency

### Day 27: README

Goal:
Write portfolio-quality README.

Must include:
- Product introduction
- Demo link
- Features
- Tech stack
- Project structure
- Key challenges
- Future improvements

### Day 28: Deployment

Goal:
Deploy to Vercel.

Tasks:
- Build test
- Fix build errors
- Deploy
- Test demo link

### Day 29: Portfolio Page Content

Goal:
Prepare portfolio explanation.

Tasks:
- Project summary
- Screenshots
- Technical highlights
- Interview talking points

### Day 30: Final Review

Goal:
Final polish.

Tasks:
- Fix bugs
- Check mobile
- Check README
- Check deployed demo

## Styling Architecture

- Use SCSS instead of Tailwind CSS.
- Create global design tokens in `src/styles/_variables.scss`.
- Create reusable mixins in `src/styles/_mixins.scss`.
- Use component-scoped SCSS for page and component styles.
- Avoid inline styles unless necessary for dynamic states.