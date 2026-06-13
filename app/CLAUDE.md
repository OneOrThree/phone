# app/ — React Native + Expo frontend

Frontend for **gromo**. Loads in addition to the root `CLAUDE.md`.
Run all commands below from inside `app/`.

## Stack

- React Native 0.81 / Expo SDK 54 / React 19.
- React Navigation — bottom tab navigator (`홈` / `그룹` / `상점` / `마이페이지`),
  with `FocusCategory` / `FocusMode` as hidden stack screens.
- AsyncStorage for local persistence; Kakao login (`@react-native-kakao`); JWT auth.

## Architecture

State is managed with the **Context API + hooks** (no Redux/MobX). Providers are
nested in `App.js`: `UserProvider › CoinProvider › EquipmentProvider › FocusProvider`.
Consume them via the hooks `useUser()` / `useCoins()` / `useEquipment()` / `useFocus()`.
State is persisted to AsyncStorage and synced to the backend through the API client.

## Layout & key modules

- `screens/` — one file per screen, PascalCase + `Screen` suffix (e.g. `HomeScreen.js`).
- `contexts/` — PascalCase + `Context` suffix; each exports a provider and a `use…()` hook.
- `components/` — PascalCase. The character system under `components/character/` is
  composition-based: `Character2D.js` assembles `parts/` using `characterVariants.js`
  configs and `styles/`.
- `utils/api.js` — the `apiFetch()` wrapper (JWT injection + 401 auto-refresh).
  **All backend calls go through this** — don't call `fetch` directly.
- `components/theme.js` — the `T` design tokens + `inkBox()` helper. **Reuse these;
  don't hardcode colors or border styles.**

## Conventions

- Functional components + hooks throughout.
- Files: PascalCase for components/screens/contexts, camelCase for utils.
- Styling: `StyleSheet.create()` using `theme.js` tokens.

## Commands

- `npm start` — Expo dev server.
- `npm run ios` / `npx expo run:ios` — native dev build.
- `npm run lint` / `npm run lint:fix` — ESLint (print-width 100, single quotes,
  trailing-comma `all`). ESLint ignores `android/` and `ios/`.
- `npm run format:check` / `npm run format:fix` — Prettier.

## iOS native (`app/ios/`)

- CocoaPods + Expo autolinking; deployment target iOS 15.1; Hermes enabled.
- Targets: `gromo` (app) + `screentimereport` (ExtensionKit Screen Time extension,
  Swift, Family Controls entitlement, **manual signing** post-Xcode-26).
- `AppDelegate.swift` handles Expo init + Kakao login URL routing (plus the
  bridging header for Swift ↔ RN).
- Release builds ship via **EAS → TestFlight**, not local Xcode archives.

## Testing

There are **no automated frontend tests**. Don't assume or claim coverage — verify
changes by running the app.
