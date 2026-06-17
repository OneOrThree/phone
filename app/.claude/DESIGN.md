---
version: alpha
name: Animal Island (React Native)
description: >-
  A cozy, pastoral UI system inspired by Animal Crossing. Rounded, tactile,
  warm-paper surfaces with a teal accent and chunky "3D bottom-shadow" press
  affordances. This spec is adapted for React Native: all dimensions use px
  (RN uses unitless density-independent pixels — treat px values as the raw
  number passed to StyleSheet), web-only effects are translated to RN
  equivalents in the prose.

colors:
  # --- Brand / Accent ---
  primary: '#19c8b9'
  primary-hover: '#3dd4c6'
  primary-active: '#50b9ab'
  primary-bg: '#e6f9f6'
  primary-deep: '#0ec4b6' # filled-button accent

  # --- Semantic ---
  success: '#6fba2c'
  success-hover: '#85cc45'
  success-active: '#5a9e1e'
  warning: '#f5c31c'
  warning-hover: '#f7d04a'
  warning-active: '#dba90e'
  error: '#e05a5a'
  error-hover: '#e87878'
  error-active: '#c94444'

  # --- Text (warm brown ink) ---
  text: '#794f27'
  text-secondary: '#9f927d'
  text-disabled: '#c4b89e'

  # --- Borders ---
  border: '#aaa69d'
  border-hover: '#827157'
  border-light: '#e8e2d6'

  # --- Surfaces (warm paper) ---
  surface: '#f8f8f0' # base background
  surface-card: '#f7f3df' # card / input fill
  surface-secondary: '#f0e8d8'
  surface-disabled: '#f0ece2'

  # --- "3D" bottom-shadow tints (used as solid drop edges) ---
  edge-neutral: '#bdaea0' # primary button bottom edge
  edge-input: '#d4c9b4' # input bottom edge

  # --- Decorative card fills (Animal-style pastel chips) ---
  card-pink: '#f8a6b2'
  card-purple: '#b77dee'
  card-blue: '#889df0'
  card-yellow: '#f7cd67'
  card-orange: '#e59266'
  card-teal: '#82d5bb'
  card-green: '#8ac68a'
  card-red: '#fc736d'
  card-lime: '#d1da49'

  # --- Overlay ---
  mask: '#00000059' # rgba(0,0,0,0.35)
  on-accent: '#ffffff'

typography:
  # fontFamily values are React Native font names. Register Nunito (and a CJK
  # fallback such as Noto Sans SC) via expo-font / react-native.config.js.
  headline-lg:
    fontFamily: Nunito
    fontSize: 24px
    fontWeight: 700
    lineHeight: 32px
  headline-md:
    fontFamily: Nunito
    fontSize: 18px
    fontWeight: 700
    lineHeight: 26px
  body-lg:
    fontFamily: Nunito
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
  body-md:
    fontFamily: Nunito
    fontSize: 14px
    fontWeight: 500
    lineHeight: 22px
  body-sm:
    fontFamily: Nunito
    fontSize: 12px
    fontWeight: 500
    lineHeight: 18px
  label-md:
    fontFamily: Nunito
    fontSize: 14px
    fontWeight: 600
    lineHeight: 14px
    letterSpacing: 0.3px

rounded:
  sm: 16px
  md: 18px
  lg: 24px
  pill: 50px # buttons / inputs / switches use full pill radius
  full: 9999px

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px

components:
  # ---- Sizes (height tokens) ----
  size-sm: 32px
  size-base: 40px
  size-lg: 48px

  # ---- Button ----
  button-primary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.pill}'
    padding: 20px
    # RN: render the 3D edge as a 5px-taller View behind the button colored
    # {colors.edge-neutral}, or borderBottomWidth: 5 / borderBottomColor.
    edgeColor: '{colors.edge-neutral}'
  button-primary-filled:
    backgroundColor: '{colors.primary-deep}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.pill}'
  button-default:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    borderColor: '{colors.border}'
    rounded: '{rounded.pill}'
  button-default-hover: # RN: apply on Pressable pressed state
    textColor: '{colors.primary}'
    borderColor: '{colors.primary}'
  button-danger:
    backgroundColor: '{colors.error}'
    textColor: '{colors.on-accent}'
    edgeColor: '{colors.error-active}'

  # ---- Card ----
  card:
    backgroundColor: '{colors.surface-card}'
    textColor: '{colors.text}'
    rounded: 20px
    padding: 16px

  # ---- Input ----
  input:
    backgroundColor: '{colors.surface-card}'
    borderColor: '{colors.text-disabled}'
    textColor: '{colors.text}'
    rounded: '{rounded.pill}'
    height: 40px
    edgeColor: '{colors.edge-input}' # bottom 3px solid shadow edge
  input-error:
    borderColor: '{colors.error}'
    edgeColor: '{colors.error-active}'

  # ---- Switch ----
  switch-track:
    backgroundColor: '#d4c9b4'
    borderColor: '{colors.text-disabled}'
    rounded: '{rounded.pill}'
    height: 28px
  switch-track-checked:
    backgroundColor: '#86d67a'
    borderColor: '{colors.success}'
  switch-handle:
    backgroundColor: '{colors.surface-card}'
    borderColor: '{colors.text-disabled}'
    rounded: '{rounded.full}'
    size: 21px

  # ---- Radio / Checkbox ----
  radio:
    borderColor: '{colors.text-disabled}'
    size: 22px
  radio-checked:
    backgroundColor: '{colors.primary}'
    borderColor: '{colors.primary}'
---

# Animal Island UI — DESIGN.md (React Native)

## Overview

Animal Island is a warm, pastoral, game-inspired interface. It should feel
**cozy, playful, and tactile** — like a friendly handheld game menu rather than
a corporate dashboard. The defining gesture is the **chunky "3D" press
affordance**: interactive surfaces (buttons, inputs) sit on a solid colored
bottom edge that visually "presses down" on touch. Everything is heavily
rounded, sits on warm off-white "paper" surfaces, and uses a soft brown ink for
text instead of pure black. The single brand accent is a bright teal.

The personality is approachable and friendly; spacing is generous and corners
are soft. Avoid sharp corners, hard pure-black text, and flat enterprise greys.

## Colors

The palette is a warm, paper-based neutral foundation with one teal brand
accent and a set of candy-pastel decorative card fills.

- **Primary / Teal (#19c8b9):** The sole brand accent. Used for focus rings,
  selected states, links, and the filled call-to-action button (`#0ec4b6`).
- **Text / Brown Ink (#794f27):** All primary text. Never use pure black —
  the warm brown keeps the friendly tone. Secondary text drops to `#9f927d`.
- **Surfaces:** A warm off-white `#f8f8f0` is the screen background; cards and
  inputs use a slightly creamier `#f7f3df`. These replace pure white.
- **Edge tints:** `#bdaea0` (buttons) and `#d4c9b4` (inputs) are _solid_ colors
  used as the bottom "3D shadow" edge, not blurred shadows.
- **Decorative card fills:** A rotating set of pastels (pink, purple, blue,
  yellow, orange, teal, green, red, lime) for category cards. On dark fills use
  white text; on light fills (yellow, lime) use brown ink.
- **Semantic:** success (green `#6fba2c`), warning (yellow `#f5c31c`), error
  (red `#e05a5a`), each with hover/active variants.

## Typography

The system uses **Nunito** — a rounded, friendly sans — as the single Latin
typeface, with a CJK fallback (Noto Sans SC) registered alongside it. Weights
stay between 500 (body) and 700 (headlines); 600 is reserved for button/label
text. The rounded letterforms reinforce the soft, approachable brand.

In React Native, register fonts with `expo-font` (`useFonts`) or link them via
the native config, then reference them by the exact `fontFamily` name. RN has no
font stack fallback array — pick one resolved family name per platform.

## Layout & Spacing

Mobile-first, single-column, generous. Use the 4px-based spacing scale
(`xs:4, sm:8, md:12, lg:16, xl:24`). Cards get 16px internal padding; screen
gutters are typically 16–24px. Group related items into rounded cards to create
the contained, "menu panel" feeling.

## Elevation & Depth

Depth is **not** conveyed with realistic blurred shadows. The signature
technique is the **solid offset bottom edge** ("3D candy button"). In React
Native, implement this in one of two ways:

1. `borderBottomWidth` + `borderBottomColor` set to the edge token (simplest),
   and shift content up on press.
2. A taller background `View` of the edge color behind the foreground surface,
   revealing ~5px (buttons) / ~3px (inputs) at the bottom; on press, translate
   the foreground down to "flatten" it.

For genuine soft shadows where needed (modals, floating cards), use RN
`elevation` (Android) + `shadowColor/shadowOffset/shadowOpacity/shadowRadius`
(iOS) with a warm `shadowColor: "#3d3428"` at low opacity (~0.1).

## Shapes

The shape language is **maximally rounded**. Buttons, inputs, and switches use a
full pill radius (`50px`); cards use `18–20px`; small chips use `16px`. Handles
and dots are full circles (`9999px`). Never mix sharp corners into this system.

## Components

- **Buttons** are pill-shaped with a 600-weight label and a 5px solid bottom
  edge. The filled CTA is teal `#0ec4b6` with white text; the default is paper
  surface with a brown label that turns teal on press. Danger uses red. Sizes:
  small (32px), middle (~45px), large (48px). On press, drop the foreground by
  the edge height to simulate the button being pushed in.
- **Cards** are creamy paper panels (`#f7f3df`, radius 20, padding 16) that lift
  slightly on press (`translateY(-2)`); decorative variants use the pastel
  fills with contrast-appropriate text.
- **Inputs** are pill-shaped paper fields with a 2px border (`#c4b89e`) and a
  3px solid bottom edge (`#d4c9b4`); focus/hover darkens the border; error state
  swaps border + edge to red tokens.
- **Switch** is a pill track (`#d4c9b4` off / `#86d67a` on) with a 2.5px border
  and a circular paper handle that slides across; checked state borders green.
- **Radio / Checkbox** use a `22px` box with a brown-tan border; selected state
  fills with the teal primary.

## Do's and Don'ts

- Do use warm brown (`#794f27`) for text — **don't** use pure black.
- Do use solid offset bottom edges for tactile depth — **don't** rely on soft
  drop shadows for buttons/inputs.
- Do keep corners fully rounded (pill for interactive elements) — **don't**
  introduce sharp or mixed corner radii.
- Do reserve teal for accents, focus, and selection — **don't** flood screens
  with the accent.
- Do use creamy paper surfaces — **don't** use pure white or cool enterprise
  greys.
- Do translate web-only CSS (`box-shadow`, `outline`, `:hover`,
  `transition: all`) into RN equivalents (border edges, `Pressable` pressed
  state, `Animated`) — **don't** assume web styles map 1:1.
