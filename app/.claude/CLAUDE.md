# 🐾 Gromo App — Frontend Guide

React Native + Expo frontend for **gromo**. This file is the single source of truth for
frontend code rules; it loads in addition to the repo-root `CLAUDE.md`.
Run all commands from inside `app/`.

---

## 📚 Doc navigation

Read in this order when you first pick up the project:

1. **[DevRunbook.md](./DevRunbook.md)** — environment setup (Node, Xcode, CocoaPods, deps, backend connection mode, first build & run).
2. **[ScreenTime_WorkLog.md](./ScreenTime_WorkLog.md)** — Screen Time feature (integration architecture, Apple Developer setup, native module dev, Metro wiring, on-device testing, troubleshooting).
3. **CLAUDE.md** — this file (code rules: structure, conventions, commit/PR workflow, gotchas).

Other work logs: see `.claude/*_WorkLog.md` — one per feature; the set grows, so
glob instead of trusting any list here.

### Planning/design reference docs (`app/.docs/`)

Original planning/design source docs live in `app/.docs/`. **This folder is in `.gitignore`
(local-only)** — they're working references, not for external sharing.

| Doc                                      | Purpose                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `MVP_화면설계_브리프.md`                 | Screen-design brief for the design AI (concept, target, screen flow)     |
| `기능명세.md`                            | Feature spec (screen/feature definitions; was `app/.claude/기능명세.md`) |
| `01-information-architecture.drawio.xml` | Information architecture (IA) diagram (draw.io)                          |

> When you receive a new planning/design source doc, put it in `app/.docs/` and add a row above.

### Feature work logs

When building a new feature, create a dedicated `<feature>_WorkLog.md` in `.claude/` and keep it
current as you go (architecture decisions + why, code changes, troubleshooting history
problem→cause→fix, build/deploy notes, checklist). Promote it into "Doc navigation" once stable.

---

## Stack

- React Native 0.86 / Expo SDK 57 / React 19, written in **TypeScript** (`strict` mode).
  최소 지원 iOS **16.4** (SDK 57 요구사항).
- React Navigation — bottom tab navigator (`홈` / `리그` / `그룹` / `전체`), with
  Stats / UsageDetail / Focus\* / Friend\* / League\* / Settings\* screens registered on the
  root stack (tab bar hidden).
- AsyncStorage for local persistence; Kakao + Apple login; JWT auth.
- HTTP via **axios** (`@/services/api`).

### Tool versions

| Tool         | Version   | Check                    |
| ------------ | --------- | ------------------------ |
| Node.js      | `24.x`    | `node --version`         |
| npm          | `10.x`    | `npm --version`          |
| Expo         | `^57.0.8` | (see package.json)       |
| React Native | `0.86.0`  | (see package.json)       |
| Xcode        | `15.0+`   | `xcode-select --version` |
| CocoaPods    | `1.14+`   | `pod --version`          |

---

## Architecture

State is managed with the **Context API + hooks** (no Redux/MobX/Zustand). Providers are
nested in `src/App.tsx`: `UserProvider › CoinProvider › EquipmentProvider › FocusProvider ›
SubjectProvider`, consumed via `useUser()` / `useCoins()` / `useEquipment()` / `useFocus()` /
`useSubjects()`. State is persisted to AsyncStorage and synced to the backend through the
axios client.

`App.tsx` only does auth/onboarding gating + provider nesting (+ app-shell components
`PushGate`, `PendingGoalApplier`); the navigators live in `src/navigation/RootNavigator.tsx`.

---

## Project structure

All source lives under **`src/`**, and imports use the **`@/` alias** (`@` = `src`) — e.g.
`@/services/api`. (tsconfig `paths` + `babel-plugin-module-resolver`. Keep `./` only for
same-folder imports.) Entry point: root `index.ts` → `./src/App`.

```
app/
├── index.ts                 # Expo entry → ./src/App
├── app.config.js            # Expo config (assets, plugins, bundle id, version)
├── babel.config.js          # babel-preset-expo + module-resolver (@/ alias)
├── tsconfig.json            # extends expo/tsconfig.base, strict, paths @/*
├── .env                     # local env (gitignored)
├── .docs/                   # planning/design docs (gitignored)
├── .claude/                 # this guide + DevRunbook + WorkLogs
├── ios/                     # native iOS (gromo app + screentimereport extension + fastlane/ + Pods)
└── src/
    ├── App.tsx              # auth gating + providers + <RootNavigator/>
    ├── assets/              # images, fonts
    ├── components/          # cross-feature UI (TabBar, DrumPicker, character/) + app shell (PushGate, PendingGoalApplier)
    ├── constants/           # design tokens — theme.ts (T, inkBox), focusCategories.ts, tiers.ts
    ├── hooks/               # cross-feature hooks only — useFocusCategory.ts
    ├── mocks/               # dev API mocking — custom axios adapter (EXPO_PUBLIC_USE_MOCK), handlers.ts + fixtures/
    ├── navigation/          # RootNavigator.tsx (NavigationContainer + Tab/Stack), navigationRef, types
    ├── screens/             # screens + per-feature folders (focus/, league/, onboarding/, settings/, stats/, group/)
    ├── services/            # API·external — api.ts (axios), *Api.ts, ScreenTimeModule.ts, analytics, push
    ├── store/               # global state (Context API): User/Coin/Equipment/Focus/Subject
    ├── types/               # shared TS types — api.ts, navigation.ts, storage.ts, dto/
    ├── utils/               # cross-feature pure helpers — localDate.ts, challengeTime.ts, deviceLocale.ts
    └── legacy/              # frozen v1 code (reference only — never import from live code)
```

### Key modules

- `src/services/api.ts` — the **axios instance `api`** (baseURL + JWT request interceptor +
  401 refresh-retry response interceptor). **All backend calls go through `api`** — never call
  `fetch` directly. axios **throws on non-2xx**, so handle errors with `try/catch`
  (`axios.isAxiosError(e)` + `e.response?.status`). Pre-login auth calls use bare `axios`
  (no interceptors).
- `src/services/ScreenTimeModule.ts` — typed JS wrapper over the native Screen Time bridge.
- `src/constants/theme.ts` — the `T` design tokens + `inkBox()` helper. **Reuse these**;
  don't hardcode colors or border styles.
- `src/components/character/` — `CharacterImage.tsx` renders the single static character
  image (`assets/character.png`).
- `src/types/` — `api.ts` (공용 DTOs), `storage.ts` (`STORAGE_KEYS`), `dto/` (feature DTOs).
  네비게이션 param lists + screen-prop helpers는 `src/navigation/types.ts`.

---

## Quick start

```bash
cd app
npm install
cd ios && pod install && cd ..

npm start                     # Metro dev server
npm run ios                   # iOS simulator
npx expo run:ios --device     # on-device (needs p12; Jaeyoung's machine only)
```

### Backend connection (`.env`)

`app/.env` is a personal, untracked file. Copy from the example (`cp app/.env.example app/.env`).
`EXPO_PUBLIC_API_URL` selects the target:

- **Team server (default, recommended)**: `EXPO_PUBLIC_API_URL=https://oneorthree.dev.mooo.com` — no backend setup needed.
- **Local backend**: bring up `back/` (Spring Boot) with `docker compose -f docker-compose.dev.yml up -d`, then `EXPO_PUBLIC_API_URL=http://localhost:8080` (use your Mac's LAN IP for a real device).

See DevRunbook.md "3.2 backend connection mode" for details.

---

## Code conventions

### Language

- All comments and commit messages in **Korean**. Keep identifiers (vars/functions/types) in **English**.

### TypeScript

- Functional components + hooks throughout.
- Components/screens/store are `.tsx`; utils/types/services/constants are `.ts`. Config files
  (`babel.config.js`, `metro.config.js`, `app.config.js`, `.eslintrc.js`, `.prettierrc.js`) stay `.js`.
- Add explicit types to component props, context values, and API responses. Put shared types in
  `src/types/`; declare screen-only response shapes as local `interface`s in that screen.

### Folders

| Folder                      | Purpose                                                                       | Examples                                         |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/screens/`              | screens + per-feature folders (colocation)                                    | `HomeScreen.tsx`, `focus/`, `league/`            |
| `src/components/`           | cross-feature UI + app shell                                                  | `TabBar.tsx`, `DrumPicker.tsx`, `PushGate.tsx`   |
| `src/components/character/` | static character image                                                        | `CharacterImage.tsx`                             |
| `src/hooks/`                | cross-feature hooks only                                                      | `useFocusCategory.ts`                            |
| `src/mocks/`                | dev API mocking — custom axios adapter, partial (`EXPO_PUBLIC_USE_MOCK=true`) | `handlers.ts`, `fixtures/`                       |
| `src/store/`                | global state (Context API)                                                    | `UserContext.tsx`, `SubjectContext.tsx`          |
| `src/services/`             | API / native / external integrations                                          | `api.ts`, `friendsApi.ts`, `ScreenTimeModule.ts` |
| `src/constants/`            | design tokens / shared style values                                           | `theme.ts`, `focusCategories.ts`                 |
| `src/utils/`                | cross-feature pure utility functions                                          | `localDate.ts`, `challengeTime.ts`               |
| `src/types/`                | shared TypeScript types                                                       | `api.ts`, `storage.ts`, `dto/`                   |
| `src/assets/`               | static resources                                                              | images, fonts, SVG                               |
| `src/legacy/`               | frozen v1 code (reference/restore only)                                       | `screens/GroupListScreen.tsx`                    |

**배치 규칙 (하이브리드 콜로케이션)** — 파일을 어디에 둘지는 아래 규칙으로 판단한다:

- **화면 전용** 훅·유틸·컴포넌트는 해당 화면의 feature 폴더에 콜로케이션한다
  (예: `screens/league/useLeagueRanking.ts`, `screens/focus/format.ts`,
  `screens/onboarding/components/StepScaffold.tsx`).
- **2곳 이상의 feature에서 쓰이는 순간** 전역 폴더(`hooks/`·`utils/`·`components/`)로 승격한다.
- **API 모듈(`*Api.ts`)은 사용처 수와 무관하게 항상 `src/services/`** — 화면 폴더에 두지 않는다.
- `src/legacy/`는 v1 보존용이다. **라이브 코드에서 `@/legacy` import 금지** — 참조·복원
  용도로만 남겨둔 것이며, 신규 코드가 필요로 하면 legacy 밖으로 꺼내 현행화한 뒤 쓴다.

### Styling

- **Colors**: always use `T.xxx` (no hardcoding).
  ```ts
  backgroundColor: T.paper,   // ✅
  backgroundColor: '#FFFFFF', // ❌
  ```
- **Box style**: use the `inkBox()` helper — `style={[s.btn, inkBox(T.mint)]}`.
- **StyleSheet**: pin a `const s = StyleSheet.create({ … })` at the bottom of the file.

### Navigation

- Visible bottom tabs (via the custom `TabBar`): `홈` | `리그` | `그룹` | `전체`.
- Root-stack screens (tab bar hidden, reached via navigation): `Stats`, `UsageDetail`,
  `FocusCategory`/`FocusSession`/`FocusResult`, `FriendAdd`/`FriendProfile`/`TierGuide`/
  `LeagueResult`, `Settings*` 계열.
- All navigator setup is in `src/navigation/RootNavigator.tsx`. Route names + params are typed in
  `src/navigation/types.ts`.

### API

- **No direct `fetch`** → use the axios instance `api` from `@/services/api`.
  ```ts
  const { data } = await api.get('/api/v1/user');
  await api.post('/api/v1/user', body); // pass the object directly; axios serializes it
  ```
- Instance behavior: JWT auto-injection (request interceptor); on 401, refresh the token and
  retry once, and log out on failure (response interceptor).
- **axios throws on non-2xx** → branch errors in `try/catch`; read the status via
  `axios.isAxiosError(e) ? e.response?.status : undefined`.
- Pre-login (token-less) auth calls use bare `axios` (no interceptors).

### AsyncStorage

- Keys are centralized in `@/types/storage.ts` (`STORAGE_KEYS`) — import them, don't re-type strings.
- Naming is unified under `gromo:…` (e.g. `gromo:accessToken`, `gromo:user`, `gromo:equipment`,
  `gromo:ownedItems`, `gromo:focus`, `gromo:screentime:*`, `gromo:selection:*`).

### Context / global state

- **Location**: `src/store/`. **Pattern**: Context API + Provider; each file exports a provider and a `use…()` hook.
- **Provider order** (in `src/App.tsx`, top → bottom): `UserProvider` → `CoinProvider` →
  `EquipmentProvider` → `FocusProvider` → `SubjectProvider` → (`PushGate` ·
  `PendingGoalApplier` ·) `<RootNavigator/>`.

---

## Native modules (iOS)

### Screen Time integration

- **Main-app module**: `ios/gromo/ScreenTimeModule.swift` — `requestAuthorization()`,
  `getAuthorizationStatus()`, 사용량 버킷·목표 모니터링, 집중 실드/Live Activity 등.
- **Extension**: `ios/screentimereport/` — `TotalActivityReport.swift` (data) +
  `TotalActivityView.swift` (UI). (익스텐션 → App Group 쓰기는 iOS가 차단 —
  `ScreenTime_WorkLog.md` 원인 3 참고.)

### App Groups

Both entitlements files declare:

```xml
<key>com.apple.security.application-groups</key>
<array>
    <string>group.com.oneorthree.gromo</string>
</array>
```

### On-device signing / provisioning

- The Apple Developer account is **Jaeyoung's personal account** (not a team account).
- Soobin signs on-device with a **p12 cert received from Jaeyoung** — not registered as an Xcode team
  member, so "check team membership in Xcode" troubleshooting does not apply.
- To add/change a capability (e.g. App Groups):
  1. Jaeyoung changes the App ID / App Group in the Apple Developer portal.
  2. Jaeyoung issues and shares a new Provisioning Profile (`.mobileprovision`).
  3. Soobin installs it (double-click) and selects it under Signing & Capabilities.

---

## Permissions & security

- Required: **FamilyControls** (read Screen Time), **App Groups** (main app ↔ extension sharing).
- `Info.plist`:
  ```xml
  <key>NSFamilyControlsUsageDescription</key>
  <string>앱별 사용 시간을 확인하기 위해 필요합니다.</string>
  ```

---

## Commands

```bash
npm start            # Metro dev server
npm run ios          # simulator
npx expo run:ios --device   # device (p12 required)

npm run typecheck    # tsc --noEmit (also in CI lint pipeline)
npm run lint         # ESLint (print-width 100, single quotes, trailing-comma all; ignores android/, ios/)
npm run lint:fix
npm run format:check # Prettier
npm run format:fix
```

---

## Commit / PR workflow

### Commit convention

`<tag>: <Korean summary>` — e.g. `feat: 로그인 화면 UI 추가`, `fix: 안드로이드 크래시 수정`,
`chore: 의존성 업데이트`, `refactor: API 통신 로직 정리`, `docs: README 작성`.

### Before committing

Run and **show results first** — don't auto-fix; let the user decide on `lint:fix`/`format:fix`:

```bash
npm run lint
npm run format:check
npm run typecheck
```

### Commit / push rule

- When a unit of work is done, propose committing and suggest the message.
- **Always show the exact commit message (and staged scope) and get approval BEFORE running
  `git commit`** — even when asked to commit.
- Never run `git push` without an explicit request.

### PR workflow

Claude does not open PRs. Instead, write a `.md` draft the user copies into GitHub.

1. **Draft location**: `app/.docs/PR_GROMO-####.md` (`.docs` is gitignored, so drafts aren't committed).
2. **Title**: `[TYPE] GROMO-#### 한 줄 요약` — TYPE ∈ `FEAT`/`FIX`/`CHORE`/`REFACTOR` (e.g. `[FEAT] GROMO-206 인게임 재화 관리 기능 구현`).
3. **Body**: follow the root [`.github/pull_request_template.md`](../../.github/pull_request_template.md) — `## Jira` (`[GROMO-####]()`), `## 변경 유형`, `## Summary` (what/why, 2–3 lines), `## Changes`, `## DB 변경` (only if schema changed), `## 주의사항` (migrations/side-effects, drop if none).
4. Share the draft path; the user reviews and opens the PR.

---

## Don'ts

- ❌ Hardcoding colors (`'#FFE566'` → use `T.yellow`).
- ❌ Calling `fetch` directly (use `@/services/api`).
- ❌ Props drilling 3+ levels instead of Context.
- ❌ Inventing AsyncStorage keys (use `STORAGE_KEYS` in `@/types/storage`).
- ❌ Large refactors without approval.
- ❌ `git push` after a local `npx expo run:ios` build without a request.

---

## Testing

- **유닛·컴포넌트 테스트 (jest)**: `npm test` — jest-expo 프리셋, `src/**/*.test.ts(x)` (GROMO-945·946·948).
  KST 고정(`jest.config.js`), AsyncStorage 공식 mock(`jest.setup.js`). CI(lint.yml)에서도 돈다.
- **E2E (Maestro)**: `./scripts/e2e.sh` — Release 시뮬 자립 빌드(dev URL 주입·서명 보정) 후
  `.maestro/flows/` 01→02→03 순서 실행. 01이 게스트 계정을 만들고 02가 집중 기록을 만들며
  03이 그 기록을 조회하는 체이닝 구조(GROMO-947). 대본 셀렉터는 **testID만** 사용 — 시스템
  알럿(권한 등)만 문구 매칭 예외. 로컬 배포 전 관문이며 CI에는 연결돼 있지 않다.
  실행이 만든 게스트 계정은 종료 시 탈퇴 API로 자동 정리된다(게스트는 앱 UI에 탈퇴 경로가
  없어 e2e.sh가 시뮬 컨테이너의 토큰으로 직접 호출).
- E2E 빌드 플래그 `EXPO_PUBLIC_E2E=1`(e2e.sh가 주입): hot-updater OTA 게이트 우회(App.tsx) +
  푸시 권한 요청 스킵(services/push.ts). 운영/일반 빌드엔 영향 없음.
- 시각 품질(레이아웃·색상)은 자동화로 못 잡는다 — QA 시나리오 수동 테스트 유지.

---

## Troubleshooting

- **App won't start** → see DevRunbook.md "Troubleshooting".
- **Native module won't load** → `pod install --repo-update`, then rebuild.
- **"No script URL" on device** → see ScreenTime_WorkLog.md "Troubleshooting".
- **Screen Time feature missing** → check Apple Developer setup + App Groups permission.
- **`Command PhaseScriptExecution failed` on native build** → usually `ios/.xcode.env.local`'s
  `NODE_BINARY` points to a node path that no longer exists; set it to an installed node.

### References

- [DevRunbook.md](./DevRunbook.md), [ScreenTime_WorkLog.md](./ScreenTime_WorkLog.md)
- [Apple DeviceActivityReport](https://developer.apple.com/documentation/deviceactivity)
- [React Native Native Modules](https://reactnative.dev/docs/native-modules-ios)

---

**Last updated**: 2026-07-20 (harness refresh — added `src/mocks/`, removed dead `eas.json`, work-log list → glob pointer)
