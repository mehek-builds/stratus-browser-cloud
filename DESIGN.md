# Stratus Design System

## Direction

Stratus is a browser operations cockpit. It should feel like an instrument panel used to supervise live infrastructure, not a marketing dashboard. Browser state, fleet capacity, failure signals, and the next action must be visible in one scan.

## Palette

- Flight ink: `#08111f`, page background
- Deep instrument: `#0d1929`, raised workspace
- Console panel: `#111f31`, primary surfaces
- Flight line: `#26394e`, structure and separators
- Porcelain: `#edf4f6`, primary text
- Mist: `#8fa6b7`, secondary text
- Signal cyan: `#4ed8d1`, active and successful state
- Signal amber: `#ffbf69`, attention and numeric emphasis
- Alert rose: `#ff7f83`, errors and destructive actions

## Type

- Display and interface: Avenir Next where available
- Condensed numeric display: Arial Narrow only for fleet figures
- Operational data: SFMono-Regular or Menlo

The hierarchy uses large, low-weight page titles, compact utility headings, and monospaced uppercase eyebrows. Body copy stays short. Data and status labels use tabular-feeling monospace treatments.

## Layout

- Sticky left navigation on desktop
- Bottom navigation on mobile
- Primary workspace occupies the widest column
- Secondary context sits to the right or below
- One-pixel separators define areas without thick card chrome
- Panels group real interactions or coherent operational areas, never decorative feature claims

## Signature element

The live browser viewport is the center of the product. It uses familiar browser chrome, a real pixel feed, a visible LIVE label, and an adjacent event stream. The overview echoes that live state through the session river and fleet radar.

## Interaction

- Signal cyan marks the primary action and current state
- Buttons use explicit verbs: Launch browser, Stop, Create identity, Deploy example
- Success toasts confirm the exact completed action
- Empty states name what is missing and the next action
- Keyboard focus is always visible
- Reduced motion disables transition effects

## Responsive behavior

- At 1050 px, navigation collapses to an icon rail and content becomes single-column where needed
- At 720 px, navigation becomes a bottom bar, cards stack, and the live viewport retains at least 320 px height
- No interaction depends on hover
