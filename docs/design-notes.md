# TripFlow AI Design Notes

## 1. Design Direction

TripFlow AI should look like a modern, premium SaaS travel workspace.

It should not look like:
- A travel blog
- A booking website
- A hotel reservation app
- A social travel app
- A simple todo list

It should feel like:
- Linear
- Notion
- ClickUp
- Wanderlog
- A clean AI SaaS dashboard

## 2. Visual Keywords

- Clean
- Modern
- Premium
- Calm
- Spacious
- Soft
- Productive
- Workspace
- Travel-inspired but not touristy

## 3. Color Tokens

Use these as the base design tokens.

```scss
$color-bg: #F7F4EE;
$color-surface: #FFFFFF;
$color-surface-soft: #FBF8F2;

$color-primary: #2D3A5E;
$color-primary-soft: #E7EDF3;

$color-accent: #C8A97E;
$color-accent-soft: #F3E5CF;

$color-text: #1F2433;
$color-muted: #7A8194;
$color-subtle: #A0A6B5;

$color-border: #E6E0D7;
$color-border-light: #EFE9E1;

$color-success: #4F8A6D;
$color-warning: #D9A441;
$color-danger: #C96C5A;
4. Radius Tokens
$radius-xs: 6px;
$radius-sm: 8px;
$radius-md: 12px;
$radius-lg: 20px;
$radius-xl: 28px;
$radius-pill: 999px;
5. Shadow Tokens
$shadow-sm: 0 4px 12px rgba(31, 36, 51, 0.06);
$shadow-md: 0 12px 30px rgba(31, 36, 51, 0.08);
$shadow-lg: 0 24px 60px rgba(31, 36, 51, 0.12);
6. Typography

Use:

Inter, Noto Sans TC, system-ui, sans-serif

Basic scale:

$font-size-xs: 12px;
$font-size-sm: 14px;
$font-size-md: 16px;
$font-size-lg: 20px;
$font-size-xl: 28px;
$font-size-2xl: 40px;
$font-size-3xl: 56px;
7. Layout Rules

General:

Use soft cream background
Use white cards
Use subtle borders
Use large spacing
Avoid heavy shadows
Avoid bright saturated colors
Keep UI calm and premium

Desktop layout:

Sidebar width: around 240px
Page padding: 24px to 32px
Card radius: 16px to 24px
Main content max width can be fluid

Trip Board desktop layout:

Left: Sidebar
Center: Kanban board
Right: Map panel
Drawer can slide from right or appear over map
8. Component Style
Buttons

Primary button:

Muted navy background
White text
Rounded pill or 12px radius
Subtle hover darken

Secondary button:

White or transparent background
Border
Dark text
Cards

Cards should have:

White background
Subtle border
Soft shadow
Rounded corners
Clear spacing
Badges

Badges should be:

Small
Rounded pill
Soft background
Muted text color
Inputs

Inputs should have:

White background
Light border
Rounded corners
Comfortable height
Clear focus state
Sidebar

Sidebar should:

Feel like a SaaS app
Have logo at top
Have navigation items
Use simple icons
Highlight active route
Kanban

Kanban columns should:

Have soft background
Have title and count
Contain place cards
Support horizontal scrolling if needed

Place cards should show:

Place name
Category badge
Estimated time
Estimated cost
Short note or AI reason
Map Panel

Map panel should:

Be part of the main workspace
Not look like a small decoration
Have marker dots
Have selected marker state
Use rounded container

Before real Leaflet integration, a CSS mock map is acceptable.

9. Responsive Rules

Desktop:

Sidebar + board + map layout

Tablet:

Sidebar can collapse
Board and map can fit side by side or stacked

Mobile:

Use tabs: Board / Map
Drawer becomes full screen
Kanban can scroll horizontally
10. Figma Reference Images

Design references should be placed here:

docs/design/landing.png
docs/design/dashboard.png
docs/design/create-trip.png
docs/design/trip-board.png

When implementing UI, use these images as visual reference but do not attempt pixel-perfect copying.

Goal:

Match visual style
Match layout hierarchy
Match component feeling
Keep code maintainable
11. UI Implementation Rule

When implementing a page:

Build static layout first
Use mock data
Avoid adding interactions too early
Extract reusable components only when needed
Keep styles scoped when possible
Use global SCSS variables for colors, radius, and shadows

## Mobile Design

Breakpoint:
- Mobile layout applies below 768px.

Layout:
- Desktop uses sidebar layout.
- Mobile uses top bar, content area, and bottom navigation.
- Sidebar is hidden on mobile.

Pages:
- Landing:
  - Reduce font sizes.
  - Stack hero content vertically.
  - Replace desktop mockup with compact preview cards.
  - Hide some testimonials.

- Dashboard:
  - Trip cards become horizontal snap scroll cards.
  - Reduce spacing.

- Create Trip:
  - Keep the same form structure.
  - Reduce card and input sizes.
  - Hide the back button because bottom navigation handles navigation.

- Trip Board:
  - Add Board / Map segmented control in the header.
  - Kanban columns scroll horizontally with snap behavior.
  - Map view becomes full screen on mobile.

Place detail:
- Desktop uses right-side drawer.
- Mobile uses bottom sheet.
- Bottom sheet has rounded top corners.
- Bottom sheet has dark overlay.
- Tapping overlay closes the sheet.