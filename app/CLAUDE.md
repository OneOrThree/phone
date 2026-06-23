# app/ — React Native + Expo frontend

Frontend for **gromo**. Loads in addition to the root `CLAUDE.md`.
Run all commands below from inside `app/`.

## Stack

- React Native 0.81 / Expo SDK 54 / React 19, written in **TypeScript** (`strict` 모드).
- React Navigation — bottom tab navigator (`홈` / `그룹` / `상점` / `마이페이지`),
  with `FocusCategory` / `FocusMode` as hidden stack screens.
- AsyncStorage for local persistence; Kakao login (`@react-native-kakao`); JWT auth.

## Architecture

State is managed with the **Context API + hooks** (no Redux/MobX). Providers are
nested in `App.tsx`: `UserProvider › CoinProvider › EquipmentProvider › FocusProvider`.
Consume them via the hooks `useUser()` / `useCoins()` / `useEquipment()` / `useFocus()`.
State is persisted to AsyncStorage and synced to the backend through the API client.

## Layout & key modules

모든 소스는 **`src/`** 아래에 있고, import는 **`@/` 별칭**(`@` = `src`)을 씁니다 — 예: `@/services/api`.
(tsconfig `paths` + `babel-plugin-module-resolver`. 같은 폴더 import만 `./` 상대경로 유지.)
진입점은 루트 `index.ts` → `./src/App`.

- `src/screens/` — one file per screen, PascalCase + `Screen` suffix (`group/`에 그룹 상세 탭들).
- `src/store/` — 전역 상태(**Context API**). PascalCase + `Context` suffix; 각 파일이 provider와 `use…()` 훅을 export.
- `src/navigation/` — `RootNavigator.tsx`가 `NavigationContainer` + Tab/Stack 네비게이터를 담당. `App.tsx`는 인증/온보딩 게이팅 + Provider 중첩만.
- `src/services/` — 외부 연동. `api.ts` = **axios 인스턴스 `api`**(JWT 요청 인터셉터 + 401 refresh-retry). **모든 백엔드 호출은 `api`로** (`api.get`/`api.post`/…), `fetch` 직접 금지. axios는 비-2xx에서 throw → `try/catch` + `axios.isAxiosError(e)`/`e.response?.status`. 로그인 전 호출은 bare `axios`. `ScreenTimeModule.ts` = 네이티브 브릿지.
- `src/components/` — 재사용 UI. `components/character/`는 조합형: `Character2D.tsx`가 `parts/`를 `characterVariants.ts`·`styles/`로 조립.
- `src/constants/theme.ts` — `T` 디자인 토큰 + `inkBox()` 헬퍼. **반드시 재사용**(색·테두리 하드코딩 금지).
- `src/utils/` — 순수 헬퍼(날짜/시간). `src/types/` — 공용 타입(`api`/`navigation`/`storage`). `src/hooks/` — 커스텀 훅(현재 비어 있음).

## Conventions

- Functional components + hooks throughout.
- **TypeScript**: components/screens/contexts are `.tsx`, utils/types are `.ts`. 컴포넌트
  props·context 값·API 응답에는 명시적 타입을 단다. 공용 타입은 `types/`
  (`api.ts`/`navigation.ts`/`storage.ts`)에 모으고, 화면 전용 응답 형태는 해당 파일에
  로컬 `interface`로 선언한다. 설정 파일(`babel.config.js` 등)은 `.js`로 유지.
- Files: PascalCase for components/screens/contexts, camelCase for utils.
- Styling: `StyleSheet.create()` using `theme.js` tokens.

## Commands

- `npm start` — Expo dev server.
- `npm run ios` / `npx expo run:ios` — native dev build.
- `npm run lint` / `npm run lint:fix` — ESLint (print-width 100, single quotes,
  trailing-comma `all`). ESLint ignores `android/` and `ios/`.
- `npm run format:check` / `npm run format:fix` — Prettier.
- `npm run typecheck` — `tsc --noEmit` 타입 검사 (CI lint 파이프라인에 포함).

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
