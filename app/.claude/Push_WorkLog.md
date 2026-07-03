# 서버 푸시 알림(FCM) WorkLog (GROMO-393)

iOS 서버 주도 푸시 알림 수신·표시·딥링크 구현 기록. 발송·배치는 백엔드(392) 몫.

- **티켓**: GROMO-393 `iOS 측 푸시 알림 권한 요청·수신·표시 처리`
- **브랜치**: `afeat/GROMO-393-server-side-apns`
- **작업일**: 2026-07-03
- **입력 명세**: `app/.docs/apns.md` (트리거·문구·Quiet hours·Dedup 정의)

---

## 1. 범위

릴리즈 0.0.5 **서버 주도 리텐션·성취 푸시**의 iOS 수신 측.

| 트리거                  | 채널                                 | 본 티켓(393)           |
| ----------------------- | ------------------------------------ | ---------------------- |
| ① 리그 승격 / ② 강등    | 서버 푸시(주간 배치)                 | 수신·표시              |
| ④ 미접속 복귀(3/7/14일) | 서버 푸시(일간 배치)                 | 수신·표시              |
| ③ 목표 사용시간 초과    | iOS 로컬 알림(DeviceActivityMonitor) | **범위 외**(별도 트랙) |

- **393(iOS, 본 작업)**: 권한 요청(M3), FCM 토큰 발급·서버 등록, 포그라운드/백그라운드/종료 수신·표시, 알림 탭 딥링크.
- **392(BE, 별개)**: 발송 파이프라인·배치·Quiet hours(21–09)·Dedup. 디바이스 토큰 저장 컬럼/엔드포인트는 **이미 존재**.

## 2. 아키텍처 결정

### 전송 방식: FCM 채택 (vs APNs 직접)

|               | A. FCM (채택)                      | B. APNs 직접          |
| ------------- | ---------------------------------- | --------------------- |
| 앱 라이브러리 | `@react-native-firebase/messaging` | expo-notifications만  |
| 저장 토큰     | FCM 토큰                           | APNs device token     |
| 백엔드(392)   | firebase-admin 발송(간단)          | APNs HTTP/2 직접 구현 |
| 크로스플랫폼  | Android 재사용 ✅                  | iOS 전용              |

**왜 A**: ① 이미 `@react-native-firebase/app`+`analytics` 설치·동작 중(절반 구축됨), ② `android.package` 설정돼 크로스플랫폼 로드맵 존재, ③ 백엔드 발송이 firebase-admin으로 단순. 리스크였던 `useFrameworks: static` 충돌은 **이미 static이 켜져 kakao/line/google/fbsdk와 공존 중**이라 신규 리스크 아님.

### 기타 결정

- **네이티브는 직접 편집**(config plugin + prebuild 아님): `ios/`가 git 추적 소스오브트루스라 `expo prebuild`는 수동 배선(family-controls·app-groups·plist 참조)을 덮어씀 → **prebuild 금지**.
- **딥링크는 navigationRef 방식**: FCM 탭 이벤트(`onNotificationOpenedApp`/`getInitialNotification`)가 payload `data.link`를 주므로, RN linking config 재구성 대신 `createNavigationContainerRef`로 명시적 라우팅. 종료 상태 콜드스타트 대비 준비 전 버퍼링 + `onReady` flush.
- **등록 시점은 로그인 후**: 엔드포인트가 `/users/me/...`라 JWT 필요 → `PushGate`가 `useUser().userId` 있을 때만 등록, 게스트(null)는 스킵.
- **포그라운드 표시**: iOS는 포그라운드 배너 자동표시 안 함 → `onMessage`에서 expo-notifications 로컬 알림으로 재표시(`setNotificationHandler`, SDK54 `shouldShowBanner/List`).

## 3. 변경 내용

### 신규

| 파일                              | 역할                                                                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/push.ts`            | 권한 요청 → `getToken()` → `PUT /api/v1/users/me/device-token`, `onTokenRefresh` 재등록, `onMessage`(포그라운드 로컬 표시), `onNotificationOpenedApp`/`getInitialNotification`(탭 딥링크) |
| `src/navigation/navigationRef.ts` | `gromo://` 딥링크 매핑(league→리그 탭, focus→FocusCategory, home→홈 탭) + 준비 전 버퍼링·`flushPendingDeepLink`                                                                           |
| `src/v2/PushGate.tsx`             | 로그인(`userId`) 상태에서만 등록·리스너 배선, 게스트 스킵. 무렌더 컴포넌트                                                                                                                |

### 수정

| 파일                               | 변경                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `index.ts`                         | `setBackgroundMessageHandler` 최상위 등록(앱 생명주기 밖)                                                |
| `src/navigation/RootNavigator.tsx` | `NavigationContainer`에 `ref`·`onReady` 연결                                                             |
| `src/v2/App.tsx`                   | 인증 브랜치에 `<PushGate/>` 마운트                                                                       |
| `app.config.js`                    | `scheme: 'gromo'`                                                                                        |
| `ios/gromo/gromo.entitlements`     | `aps-environment` = `development`                                                                        |
| `ios/gromo/Info.plist`             | `UIBackgroundModes: [remote-notification]` + `gromo` URL scheme                                          |
| `package.json`                     | `@react-native-firebase/messaging@25.1.0` (app/analytics와 버전 통일 — RNFirebase는 계열 버전 일치 필수) |

### pod install 부수효과

- `ios/Podfile.lock`: `RNFBMessaging 25.1.0` + `FirebaseMessaging 12.15.0` 추가.
- `ios/gromo.xcodeproj/project.pbxproj`: 메시징 pod 통합.

## 4. 동작 매핑

| 상태            | 처리                                                              | 탭 → 딥링크                                  |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| 포그라운드 수신 | `onMessage` → expo-notifications 로컬 표시                        | expo response 리스너                         |
| 백그라운드 배너 | OS 자동 표시                                                      | `onNotificationOpenedApp`                    |
| 종료→알림 실행  | —                                                                 | `getInitialNotification`(버퍼→onReady flush) |
| 토큰 발급/갱신  | `getToken`/`onTokenRefresh` → `PUT /api/v1/users/me/device-token` | —                                            |

딥링크: `gromo://league`→`Main`/리그, `focus`→`FocusCategory`, `home`→`Main`/홈. (스펙 GROMO-393에서 스킴 확정)

## 5. 빌드·배포 노트

- **Phase 1(콘솔 셋업, 완료)**: Firebase iOS 앱 등록, `GoogleService-Info.plist` 배치, APNs `.p8` 키 → Firebase Cloud Messaging 업로드, App ID Push capability + 프로비저닝 재발급.
- **`GoogleService-Info.plist`는 gitignore**(로컬/EAS secret) — 팀원 각자 로컬 배치. pbxproj엔 이미 번들 참조 존재.
- ⚠️ **`aps-environment=development`**: TestFlight/배포 빌드는 `production`으로 교체 필요(sandbox↔production APNs 환경 일치). 안 하면 배포 빌드에서 푸시 안 옴.
- ⚠️ **`expo prebuild` 금지**(§2).
- **New Architecture 호환**: main #102가 New Arch를 켜서 앱이 Fabric/TurboModules로 동작. RNFirebase 25는 New Arch 지원. 단 firebase framework 모듈이 프리빌트 RN 코어와 충돌하므로 `ios.buildReactNativeFromSource: true`(소스 빌드)가 **반드시 유지돼야** 함(§6, NewArch WorkLog §8).

## 6. 트러블슈팅 기록

### pod install "Permission denied @ fmt/base.h" (샌드박스)

- **문제**: `pod install` post_install 훅 실패 — `[!] An error occurred while processing the post-install hook`, `Permission denied @ rb_sysopen - ios/Pods/fmt/include/fmt/base.h`. 게다가 `| tail` 파이프의 exit code(0)에 속아 성공으로 오판.
- **원인**: Expo Podfile의 fmt consteval 패치(`File.write`)가 **샌드박스 실행 환경**에서 쓰기 차단. firebase/messaging과 무관.
- **해결**: 샌드박스 해제 + `chmod -R u+w ios/Pods` 후 재실행, 성공은 **Podfile.lock의 pod 통합**으로 검증(파이프 exit code 신뢰 금지). 사용자 로컬 머신(`npx expo run:ios`)에선 애초에 발생 안 함.

### New Architecture 병합 충돌 (main #102/#103)

- **문제**: 작업 중 main이 앞서감 — New Arch 전환(#102) + 버전 0.1.0 통일(#103)이 `app.config.js`·`Info.plist`·`Podfile.lock`과 충돌.
- **해결**:
  - `app.config.js`: `scheme` 유지 + `version: 0.1.0` 채택.
  - `Info.plist`: `RCTNewArchEnabled: true`(main) + `UIBackgroundModes`(내 것) 양쪽 유지.
  - `Podfile.lock`: main(New Arch) 기준으로 잡고 **pod install 재생성** → messaging + Fabric pod 공존. (생성물은 손 병합보다 재생성)
  - 검증: `ios.buildReactNativeFromSource: true` 보존 + Podfile.lock 프리빌트 코어 0/소스 코어 사용 확인 → RNFBMessaging도 소스 코어와 빌드되어 비모듈러 헤더 에러(NewArch §8) 회피.

### RNFBMessaging × New Arch 프리빌트 코어 (예방)

- New Arch에서 firebase framework 모듈(`RNFBApp`/`RNFBMessaging`)이 프리빌트 React 헤더(비모듈러)와 충돌해 `include of non-modular header inside framework module` 에러 가능. `ios.buildReactNativeFromSource: true`가 프리빌트를 끄고 소스 빌드로 되돌려 해소(NewArch WorkLog §8). messaging 추가 후에도 이 플래그 유지 확인 필수.

## 7. 실기기 검증 체크리스트

시뮬레이터는 FCM 토큰 불안정 → **실기기 필수**. 서버 발송(392) 전이라 **Firebase Console 테스트 발송**으로 iOS 측 완결 검증.

- [ ] 실기기 빌드 성공 (New Arch + messaging 소스 코어)
- [ ] 권한 팝업 표시·허용 → 상태 반영
- [ ] FCM 토큰 발급 로그 + `PUT /api/v1/users/me/device-token` 200 + `User.deviceToken` 저장
- [ ] Firebase Console 테스트 발송(payload `data.link`) → 포그라운드 표시
- [ ] 백그라운드 배너 → 탭 → 딥링크(league/focus/home)
- [ ] 종료 상태 알림 탭 → 딥링크(버퍼→flush)
- [ ] 토큰 갱신 재등록(`onTokenRefresh`)
- [ ] 권한 거부 시 등록 스킵 / 게스트(userId null) 스킵
- [ ] (392 완료 후) 서버 트리거 e2e — 승격/강등/미접속

## 8. 392(BE) 인계 사항

- **`User.deviceToken` = FCM 토큰** 계약 확정 → 백엔드는 firebase-admin으로 FCM 발송.
- 발송 payload에 **딥링크 타깃**(`data.link`, 예: `gromo://league`) 포함 — 393 스킴과 일치.
- Quiet hours(21–09)·Dedup(리그>복귀)은 **서버 처리**, iOS는 표시만.

## 9. 후속 / 남은 것

- ③ 목표 초과 로컬 알림(DeviceActivityMonitor) — 별도 트랙(Screen Time 확장).
- M3 권한 사전 설명 화면(온보딩 09a/09b) — 현재는 로그인 직후 시스템 팝업.
- 리치 알림(NotificationService 익스텐션) 활용 — 현재 미사용, 필요 시 이미지/mutable-content 확장 가능.
- 안정화 후 이 WorkLog를 CLAUDE.md "Doc navigation"에 승격.
