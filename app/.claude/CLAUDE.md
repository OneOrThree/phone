# 🐾 Gromo App 프로젝트 가이드

---

## 📚 문서 네비게이션

**처음 이 프로젝트를 받았다면 이 순서대로 읽으세요:**

1. **[DevRunbook.md](./DevRunbook.md)** ← 먼저 읽기 (환경 구축)
   - Node.js, npm, Xcode, CocoaPods 설치
   - 프로젝트 의존성 설치
   - 개발 환경 설정 (백엔드 연결 모드 포함)
   - 처음 빌드 & 실행

2. **[ScreenTime_WorkLog.md](./ScreenTime_WorkLog.md)** ← 스크린타임 표시 기능
   - 스크린 타임 통합 아키텍처
   - Apple Developer 설정
   - 네이티브 모듈 개발
   - Metro 번들러 연결
   - 실기기 테스트
   - 트러블슈팅

3. **[ScreenTime2_WorkLog.md](./ScreenTime2_WorkLog.md)** ← 보상 모듈
   - 목표 달성 판정 아키텍처
   - 구조적 제약 분석 (Report 익스텐션 read-only)
   - 미해결 이슈 및 다음 할 일

4. **[Shop_WorkLog.md](./Shop_WorkLog.md)** ← 상점 기능
   - MVP 제외로 탭에서 숨김 처리 (코드 보존)
   - 복원 방법 및 구현 현황

5. **[CLAUDE.md](./CLAUDE.md)** ← 지금 이 문서 (코드 규칙)
   - 폴더 구조
   - 코딩 규칙
   - 커밋 컨벤션
   - 주의사항

---

## 📓 기능 개발 Work Log

새 기능을 개발할 때는 `.claude/` 폴더에 전용 `<기능명>_WorkLog.md` 파일을 만들고, 개발 진행 중 계속 참고/작성합니다. (예: [ScreenTime_WorkLog.md](./ScreenTime_WorkLog.md))

- **기록 내용**: 아키텍처/설계 결정과 이유, 코드 변경 사항, 트러블슈팅 히스토리(문제 → 원인 → 해결), 빌드/배포 주의사항, 체크리스트
- 작업 중간에 끊겨도 이 파일만 보면 진행 상황과 맥락을 이어갈 수 있도록 최신 상태로 유지
- 기능이 안정화되면 "📚 문서 네비게이션"에 추가

---

## 📁 폴더 구조

```
app/
├── .claude/
│   ├── DevRunbook.md         ← 환경 구축 가이드
│   ├── ScreenTime_WorkLog.md ← 개발 가이드 & 트러블슈팅
│   └── CLAUDE.md             ← 이 파일 (코드 규칙)
├── screens/                  # 화면 단위 컴포넌트
├── components/               # 재사용 UI 컴포넌트
├── contexts/                 # 전역 상태 (Context API)
├── utils/                    # 유틸리티 모듈
│   ├── api.js                # HTTP 클라이언트
│   └── ScreenTimeModule.js   # iOS 스크린 타임 브릿지
├── assets/                   # 이미지, 폰트 등
├── ios/                      # iOS 네이티브 코드
│   ├── gromo/                # 메인 앱 타겟
│   ├── screentimereport/     # 스크린 타임 리포트 익스텐션
│   └── Pods/                 # CocoaPods 의존성
├── .env                      # 환경 변수 (개인 설정, git ignore)
├── package.json              # JavaScript 의존성
├── App.js                    # 앱 진입점
└── README.md                 # 프로젝트 개요
```

---

## 💻 주요 개발 도구 버전

| 도구         | 버전      | 명령어                   |
| ------------ | --------- | ------------------------ |
| Node.js      | `22.x`    | `node --version`         |
| npm          | `10.x`    | `npm --version`          |
| Expo         | `~54.0.0` | (package.json 참고)      |
| React Native | `^0.81.5` | (package.json 참고)      |
| Xcode        | `15.0+`   | `xcode-select --version` |
| CocoaPods    | `1.14+`   | `pod --version`          |

---

## 🚀 빠른 시작

```bash
# 환경 구축 (DevRunbook.md 참고)
cd app
npm install
cd ios && pod install && cd ..

# 개발 서버 시작
npm start

# iOS 시뮬레이터 실행
npm run ios

# 또는 실기기
npx expo run:ios --device #이거는 재영님만 실행가능함ㅋㅋㅋㅋ 하
```

---

## 🔌 백엔드 연결 (.env)

`app/.env`는 git에 없는 개인 설정 파일입니다. `app/.env.example`을 복사해서 만드세요 (`cp app/.env.example app/.env`). `EXPO_PUBLIC_API_URL`로 연결 대상을 선택합니다.

- **팀 서버 (기본, 추천)**: `EXPO_PUBLIC_API_URL=https://oneorthree.mooo.com` — 백엔드 설치 불필요
- **로컬 백엔드**: `back/`(Spring Boot)을 `docker compose -f docker-compose.dev.yml up -d`로 띄운 뒤 `EXPO_PUBLIC_API_URL=http://localhost:8080` (실기기는 맥북 로컬 IP 사용)

자세한 내용은 [DevRunbook.md](./DevRunbook.md)의 "3.2 백엔드 연결 모드 선택" 참고.

---

## 📝 코드 규칙

### 언어 및 커뮤니케이션

- 모든 주석과 커밋 메시지는 **한국어**
- 변수명/함수명은 **영어 유지**
- 코드 예제는 명확하게

### 폴더 규칙

| 폴더                    | 용도                      | 예시                                       |
| ----------------------- | ------------------------- | ------------------------------------------ |
| `screens/`              | 탭/네비게이션 단위 화면   | `HomeScreen.js`, `MyPageScreen.js`         |
| `components/`           | 재사용 가능한 UI 컴포넌트 | `Button.js`, `Card.js`                     |
| `components/character/` | 캐릭터 파츠/스타일        | `CharacterHead.js`, `characterVariants.js` |
| `contexts/`             | 전역 상태 관리            | `UserContext.js`, `CoinContext.js`         |
| `utils/`                | 유틸리티 함수 & API       | `api.js`, `ScreenTimeModule.js`            |
| `assets/`               | 정적 리소스               | 이미지, 폰트, SVG                          |

### 스타일 규칙

- **색상**: 반드시 `T.xxx` 사용 (하드코딩 금지)

  ```js
  backgroundColor: T.paper,  // ✅
  backgroundColor: '#FFFFFF', // ❌
  ```

- **버튼 스타일**: `inkBox()` 함수 사용

  ```js
  style={[s.btn, inkBox(T.mint)]}
  ```

- **StyleSheet**: 파일 하단에 `const s =` 로 고정
  ```js
  const s = StyleSheet.create({
    /* ... */
  });
  ```

### 네비게이션 규칙

- 탭 네비게이터: `홈` | `그룹` | `상점` | `마이페이지`
- 탭바 숨김 화면: `FocusCategoryScreen`, `FocusMode`, `ScreenTime`
  - 등록 위치: `App.js`의 `Tab.Navigator`
  - 탭바 숨김 코드: `tabBarStyle` 배열에 화면 이름 추가

### API 통신 규칙

- **fetch 직접 사용 금지** → `apiFetch()` 함수 사용
  ```js
  const res = await apiFetch('/api/v1/user', { method: 'GET' });
  ```
- 기능: JWT 자동 주입, 토큰 갱신, 자동 로그아웃 처리 포함

### AsyncStorage 규칙

- **키 네이밍**: `gromo:xxx` 통일
  ```js
  gromo:accessToken      // JWT 토큰
  gromo:user             // 사용자 정보
  gromo:coins            // 코인 수
  gromo:equipment        // 장착 아이템
  gromo:screentime:*     // 스크린 타임 관련
  ```

### Context / 전역 상태 규칙

- **위치**: `contexts/` 폴더
- **패턴**: Context API + Provider
- **Provider 순서** (App.js, 위 → 아래):
  ```
  UserProvider (최상위)
  └─ CoinProvider
     └─ EquipmentProvider
        └─ FocusProvider
           └─ NavigationContainer
  ```

---

## 🧭 네이티브 모듈 (iOS)

### 스크린 타임 통합

- **메인 앱 모듈**: `ios/gromo/ScreenTimeModule.swift`
  - 권한 요청: `requestAuthorization()`
  - 권한 상태 확인: `getAuthorizationStatus()`
  - 총 사용 시간 조회: `getTotalScreenTime()` (App Group 경유)

- **익스텐션**: `ios/screentimereport/`
  - `TotalActivityReport.swift` — 데이터 처리
  - `TotalActivityView.swift` — UI 렌더링
  - App Group UserDefaults에 데이터 저장

### App Groups 설정

**Entitlements 파일 (두 개)**:

```xml
<key>com.apple.security.application-groups</key>
<array>
    <string>group.com.oneorthree.gromo</string>
</array>
```

### 실기기 서명 / 프로비저닝

- **Apple Developer 계정은 재영님 개인 계정** (팀 계정 아님)
- 안수빈은 재영님에게 받은 **p12 인증서로 실기기 서명** — Xcode Settings → Accounts에 팀 멤버로 등록되어 있지 않음
  - 따라서 "Xcode에서 팀 계정/멤버 권한 확인" 같은 트러블슈팅은 해당 사항 없음
- App Groups 등 capability를 새로 추가/변경해야 하면:
  1. 재영님이 Apple Developer 포털에서 App ID / App Group 설정 변경
  2. 재영님이 새 Provisioning Profile(`.mobileprovision`) 발급해서 전달
  3. 안수빈은 받은 프로파일을 Xcode에 설치(더블클릭) 후 Signing & Capabilities에서 선택

---

## 🔐 권한 및 보안

### 필수 권한

- **FamilyControls** (스크린 타임 읽기)
- **App Groups** (메인 앱 ↔ 익스텐션 데이터 공유)

### Info.plist 설정

```xml
<!-- 스크린 타임 권한 설명 -->
<key>NSFamilyControlsUsageDescription</key>
<string>앱별 사용 시간을 확인하기 위해 필요합니다.</string>
```

---

## 📋 커밋 컨벤션

```
<태그>: <한국어 설명>

feat: 로그인 화면 UI 추가
fix: 안드로이드 크래시 수정
chore: 의존성 업데이트
refactor: API 통신 로직 정리
docs: README 작성
```

---

## ✅ 커밋 전 체크리스트

커밋을 제안하기 전에 아래 검사를 먼저 실행합니다.

```bash
npm run lint
npm run format:check
```

- 에러/경고가 있으면 **자동으로 수정하지 않고** 결과를 먼저 보여주고 사용자에게 확인받기
- `lint:fix` / `format:fix`로 수정할지는 사용자가 결정

---

## 💾 커밋 / 푸시 규칙

- 커밋할만한 작업 단위가 끝나면 먼저 "커밋하면 좋겠다"고 제안하고, 커밋 메시지(`태그: 한국어 설명`)도 함께 추천
- Claude는 **절대 `git commit` / `git push`를 직접 실행하지 않음** — 항상 사용자가 직접 실행하거나 명시적으로 요청해야 함

---

## ⚠️ 하지 말아야 할 것

- ❌ 색상 하드코딩 (`'#FFE566'` 대신 `T.yellow`)
- ❌ Context 없이 props drilling 3단계 이상
- ❌ AsyncStorage 키 임의 생성 (문서의 키 목록 참고)
- ❌ Character2D.js에 직접 파츠 스타일 추가
- ❌ 승인 없이 대규모 리팩토링
- ❌ `npx expo run:ios`로 빌드 후 `git push` 임의로 하기

---

## 🛠️ 개발/빌드 명령어

```bash
# 개발 서버
npm start                    # Metro 번들러

# 빌드 & 실행
npm run ios                  # 시뮬레이터
npx expo run:ios --device   # 실기기 (p12 필요)

# 코드 검사
npm run lint                 # ESLint
npm run lint:fix             # 자동 수정
npm run format:check         # Prettier 검사
npm run format:fix           # 자동 정렬
```

---

## 📖 참고 문서

- [DevRunbook.md](./DevRunbook.md) — 환경 구축
- [ScreenTime_WorkLog.md](./ScreenTime_WorkLog.md) — 개발 & 트러블슈팅
- [Apple DeviceActivityReport](https://developer.apple.com/documentation/deviceactivity)
- [React Native Native Modules](https://reactnative.dev/docs/native-modules-ios)

---

## 💬 문제 해결

**Q: 앱이 안 켜져요**

- A: DevRunbook.md의 "문제 해결" 섹션 참고

**Q: 네이티브 모듈이 안 로드돼요**

- A: `pod install --repo-update` 후 재빌드

**Q: 실기기에서 "No script URL" 에러**

- A: ScreenTime_WorkLog.md의 "트러블슈팅" 섹션 참고

**Q: 스크린 타임 기능이 안 나와요**

- A: Apple Developer 설정 및 App Groups 권한 확인

---

**최종 업데이트**: 2026-06-16
