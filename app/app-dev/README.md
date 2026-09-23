# GROMO 2.0 앱

GROMO 2.0의 활성 React Native·Expo 앱입니다. 세로·가로 레이아웃과 iOS·Android·웹을 지원하며, 현재 제품 흐름은 로컬 목업 상태와 저장소를 사용합니다.

## 로컬 실행

```sh
npm ci
npm start
```

Expo 개발 서버에서 플랫폼을 선택하거나 아래 명령으로 바로 실행할 수 있습니다.

```sh
npm run ios
npm run android
npm run web
```

루트의 `RN-앱-열기.command`와 `GROMO-데모.command`는 macOS에서 개발 서버 또는 정적 웹 빌드를 여는 보조 스크립트입니다.

일반 URL은 첫 시작부터 진행합니다. `?demo=1`은 완공된 마을 체험, `?review=1`은 검증 스크립트의 상태 주입용입니다. 두 모드는 기존 로컬 저장을 읽거나 덮어쓰지 않습니다.

### 캐릭터 스프라이트 모션

웹 주소에 `?motion=1`을 붙이면 앱에서 쓰는 `CatSprite`로 고양이 6종의 동작을 비교할 수 있습니다. 동작 버튼을 다시 누르면 처음부터 재생하며, 왼쪽 보기와 모션 줄이기도 확인할 수 있습니다. 이 미리보기는 계정이나 로컬 저장 데이터를 사용하지 않습니다.

메인 고양이는 이동할 때 걷고, 멈추면 눈 깜박임·갸웃·하품·기지개·그루밍을 간헐적으로 재생합니다. 집중 화면에서는 낚시 동작을 유지하고 물고기를 잡은 직후에만 낚아올리기로 전환합니다. 동작 간 발 위치를 기준으로 정렬하며, 모션 줄이기 또는 앱 백그라운드 상태에서는 스프라이트 재생을 중단합니다. NPC 전용 동작 확장은 이 작업 범위에 포함하지 않습니다.

```sh
# 실행 중인 웹 서버를 대상으로 6종·프레임 변경·좌우 반전·모션 줄이기와 화면 진입 검증
MOTION_REVIEW_URL=http://localhost:8081 node scripts/review-cat-motion.cjs
```

검증 결과와 화면 캡처는 `.docs/cat-motion/`에 저장됩니다. 브라우저 검증은 실제 저사양 iOS·Android 기기의 프레임 성능 검증을 대신하지 않습니다.

## 구조

- `src/App.tsx`: 앱 상태·저장·화면 전환·음원 재생
- `src/screens/`: 섬, 집중, 탐색, 인테리어, 꾸미기, 월드 화면
- `src/design-system/`: UI kit 기반 토큰·타이포그래피·공용 UI·화면 조합 패턴
- `src/components/`: 캐릭터·연출처럼 도메인에 가까운 공용 컴포넌트
- `src/services/model.ts`: 재화·건설·집중·퀘스트·친구 정책
- `src/hooks/`: 카메라와 사운드 훅
- `src/utils/`: 섬 경로·카메라·월드 그리드 계산
- `src/constants/`: 에셋 레지스트리와 월드·모션 상수
- `src/assets/`: 앱에 번들되는 이미지·폰트·오디오
- `ios/`, `android/`: 가져온 네이티브 프로젝트
- `scripts/`: 화면·사용자 여정 검증 도구. 결과는 gitignored `.docs/`에 생성

## 검증

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npx expo export --platform all
```

웹 상호작용 검증은 정적 빌드를 로컬 서버로 띄운 뒤 실행합니다.

```sh
npm run build:all
python3 -m http.server 18762 --bind 127.0.0.1 --directory dist-all
npm run review:v2
npm run review:v2-journeys
```

## 현재 연결 범위

화면 전환, 로컬 저장, 집중 구간 계산, 공동 재화, 건설 타이머와 음원 재생은 앱 안에서 동작합니다. 인증, 다른 기기의 주민·편지·가입 승인, 서버 랭킹, OS 스크린타임 수집, 푸시와 원격 음악 동기화는 아직 로컬 목업 범위입니다.

앱 버전은 `2.0.0`, iOS·Android 식별자는 `com.oneorthree.focuscat`입니다.

### 서버 API 기반 (`src/services/api/`, GROMO-2004)

정본 계약은 [`docs/prd/fishcat/account/low-level-design.md`](../../docs/prd/fishcat/account/low-level-design.md)입니다.

| 파일                    | 역할                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client.ts`             | 베이스 URL 해석 · `Authorization: Bearer` 주입 · 15초 타임아웃(본문 읽기 포함) · `{data}` 봉투 해제 · 오류 봉투 → `ApiError` · 멱등 키(`uuid()`) |
| `session.ts`            | 토큰 보관(expo-secure-store, 웹은 AsyncStorage) · **커밋 마커로 원자 저장** · 세션 세대 · 401 세션 상실 알림                                     |
| `auth.ts`               | 인증 도메인 — `login` · `logout` · `me` · `checkSession`                                                                                         |
| `restore.ts` (한 층 위) | 재시작 복구 화면 판정. 서버 세션이 있으면 온보딩 여부는 서버가 정본                                                                              |

**오류 봉투는 `{ "error": { code, message, field, retryable }, "requestId": "..." }` 입니다**(LLD §1·§5). `docs/conventions/error-contract.md` 의 최상위 `{code,message}` 는 data-api·legacy 형태이며 무접두 공개 경로에는 쓰이지 않습니다 — `client.ts` 가 둘 다 읽되 신규 형태를 먼저 봅니다. `code` 문자열이 계약이므로 화면은 `ApiError.code` 로 분기합니다.

**새 도메인은 `src/services/api/<도메인>.ts` 를 새로 만듭니다.** `auth.ts` 에 얹지 않습니다 — 한 파일에 몰면 병렬 티켓이 서로의 머지 충돌이 됩니다. 요청은 전부 `client.ts` 의 `request()` 를 지나고, 명령성 요청(PATCH `/me` · DELETE `/me` · PATCH `/me/settings`)은 `uuid()` 로 만든 `idempotencyKey` 를 넘기며 **재시도는 같은 값으로** 보냅니다.

**계정 전환**(A→B, 같은 사용자 s1→s2 재로그인 포함)은 `login()` 이 LLD §2.4 의 「준비 → commit → commit 뒤 전달」 순서로 **이전 세션 RT 폐기까지만** 합니다. FCM 토큰 재발급·B 세션 bootstrap 재등록·`deliveryTag` 대조와 commit 직후의 결과 세션 채택 확인 요청은 기기·푸시 등록 티켓 몫입니다.

아직 서버에 없는 것: 2.0 공개 표면(business-api)에 **토큰 갱신 엔드포인트(GROMO-2035)와 게스트 세션 발급(GROMO-2036)이 없습니다.** 그래서 401 의 답은 재로그인뿐이고, 로그인 화면의 소셜 제공자 연결(Apple·Google·Kakao SDK)도 아직 붙어 있지 않습니다. LLD §2.1 의 `X-Device-Bootstrap` 응답 헤더도 서버 미구현이라 `login()` 이 받지 못합니다 — 푸시 기기 등록 티켓이 이 값을 쓰려면 `request()` 가 응답 헤더를 넘겨주도록 한 줄 늘려야 합니다.

## TestFlight

기존 Gromo의 로컬 App Store Connect API 키 설정을 재사용해 Fishcat 테스트 빌드를 올립니다.

```sh
cd ios
./testflight.sh
```

스크립트는 Pods와 Fastlane 의존성을 확인하고, App Store Connect의 `2.0.0` 최신 빌드번호 다음 번호로 archive·업로드합니다. Fishcat 전용 키를 쓰려면 `ios/fastlane/.env`에 `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`를 설정합니다.
