# gromo

집중 시간 관리 + 캐릭터 커스터마이징 앱
모노레포: React Native(Expo) 앱 + Spring Boot 백엔드

## 프로젝트 구조

```
gromo/
  app/            # React Native 앱 (Expo) — iOS 스크린타임 익스텐션 포함
  back/           # Spring Boot 백엔드 (Java 17 + PostgreSQL)
  loadtest/       # k6 부하테스트 하네스 (GCP 러너 + 대시보드)
  observability/  # dev 관측 스택 (Prometheus·Grafana·Loki·Datadog)
```

> 각 디렉토리의 `CLAUDE.md`(루트 / `app` / `back`)에 개발 가이드와 컨벤션이 정리되어 있어요.
> 부하테스트는 `loadtest/README.md`, dev 관측 스택은 `observability/README.md` 참고.
> DB 스키마는 Flyway 마이그레이션(`back/src/main/resources/db/migration/`)이 소스예요.

---

## 시작하기 — 앱 (`app/`)

### 사전 준비

- [Node.js 24+](https://nodejs.org)
- Android Studio 또는 Xcode (에뮬레이터/시뮬레이터)
- iOS 빌드 시 [CocoaPods](https://cocoapods.org) (`pod install`용)
- TestFlight 배포 시 Ruby + Bundler (fastlane용 — 아래 [TestFlight 배포](#testflight-배포) 참고)
- 또는 실기기 + [Expo Dev Client](https://docs.expo.dev/develop/development-builds/introduction/)

### 설치 및 실행

```bash
cd app
npm install
cp .env.example .env             # 환경변수 파일 생성 (아래에서 API 서버 지정)
cd ios && pod install && cd ..   # iOS 네이티브 의존성 (CocoaPods 필요)

npx expo start                   # 개발 서버 시작
```

`.env`의 `EXPO_PUBLIC_API_URL`로 붙을 백엔드를 정해요.

- **팀 서버(기본·권장)**: `EXPO_PUBLIC_API_URL=https://xxxxxxxxxx.com` — 백엔드 셋업 불필요
- **로컬 백엔드**: `back/`를 띄운 뒤 `EXPO_PUBLIC_API_URL=http://localhost:8080` (실기기는 Mac의 LAN IP 사용)

### 웹 디버깅

웹 개발 서버는 운영 API URL이 환경변수에 있어도 항상 로컬 백엔드(`localhost:8080`)를
사용합니다. 웹 배포 번들은 항상 팀 dev API를 사용합니다.

저장소 루트의 `local-web.command`를 더블클릭하거나 아래 명령 하나만 실행합니다.

```bash
./local-web.command
```

이 실행기가 Docker DB → 로컬 설정 생성 → 백엔드 → 재실행 가능한 더미 데이터 → Expo 웹을
순서대로 준비합니다. 이미 떠 있는 DB·백엔드는 그대로 재사용하고, 사용 가능한 웹 포트를 자동으로
고릅니다.

더미 데이터에는 고정 유저 24명, 90일 집중·스크린타임 통계, 실제 집중 세션, 친구·받은 요청·핀,
리그, 그룹 8개와 공지, 스트릭·재화 원장이 포함됩니다. 실행 후 새로 온보딩을 완료한 로컬 계정도
즉시 친구 10명·받은 요청 4명·고정 친구 3명과 대표 그룹, 리그·재화 데이터에 연결됩니다.

브라우저에서 Expo가 출력한 URL(기본 <http://localhost:8081>)로 접속합니다. 네이티브 소셜
로그인·푸시·스크린타임은 웹에서 비활성화되고 게스트 로그인으로 나머지 화면을 확인할 수 있습니다.
화면 레이아웃과 애니메이션은 네이티브와 같은 구현을 공유하고, 플랫폼별 입력·SDK adapter만 분리합니다.

> `pod install`은 iOS 네이티브 빌드용이에요. 최초 1회, 그리고 브랜치 전환·네이티브 패키지
> 추가 후에 다시 돌려주세요. (Android는 불필요)
>
> 개발용 앱이 아직 기기에 없다면 최초 1회만 USB로 연결해 네이티브 빌드를 설치해요.
> (이후엔 와이파이만으로 충분)
>
> ```bash
> npx expo run:ios --device       # iOS (Mac + Xcode + p12 서명 필요)
> npx expo run:android --device   # Android (USB 디버깅 켠 상태)
> ```

### TestFlight 배포

**로컬 fastlane**으로 TestFlight에 올려요. 셋업이 끝나 있으면 아래 한 방이면 됩니다.
(빌드는 macOS + Xcode 필요)

```bash
cd app/ios
./testflight.sh
```

**최초 1회 셋업** (이미 되어 있으면 생략)

1. **fastlane 설치** — 전역 설치 대신 Gemfile(번들러)로 관리해요.
   ```bash
   cd app/ios
   bundle install       # Gemfile 의 fastlane 설치 (Ruby·Bundler 필요)
   ```
2. **인증** — App Store Connect API Key(`.p8`)로 로그인해요.
   `app/ios/fastlane/.env`(gitignore됨)에 아래 3개를 넣어둡니다.
   ```bash
   ASC_KEY_ID=XXXXXXXXXX          # AuthKey_XXXXXXXXXX.p8 의 키 ID
   ASC_ISSUER_ID=xxxxxxxx-....    # ASC → 사용자 및 액세스 → 통합(Integrations) 상단
   ASC_KEY_PATH=/절대경로/AuthKey_XXXXXXXXXX.p8
   ```
3. **서명** — 재영님 개인 Apple 계정의 distribution p12 인증서 + 7개 타겟용
   `distribution-gromo-*` 프로비저닝 프로파일(수동 서명)이 키체인/Xcode에 설치돼 있어야 해요.

> 자주 막히는 곳(codesign `errSecInternalComponent`, Pods sync 등)과 서명 셋업 상세는
> `app/.claude/CLAUDE.md` 및 관련 WorkLog을 참고하세요.

---

## 시작하기 — 백엔드 (`back/`)

### 사전 준비

- Java 17
- Docker (로컬 PostgreSQL · 테스트 컨테이너용)

### 실행

```bash
cd back
docker compose -f ../docker-compose.local.yml up -d   # 로컬 PostgreSQL

# 최초 1회: 로컬 설정 파일 생성 (gitignore됨 — Flyway 비활성 등 로컬 기본값 포함)
cp src/main/resources/application-local.yml.example src/main/resources/application-local.yml

./gradlew bootRun
```

- API: <http://localhost:8080>
- Swagger UI: <http://localhost:8080/swagger-ui/index.html>

### 테스트 · 코드 검사

```bash
./test-local.sh                                  # Testcontainers 기반 테스트
./gradlew checkstyleMain spotbugsMain test       # CI와 동일한 검사

# 로컬 DB 초기화 (볼륨 삭제 → 새 DB)
docker compose -f ../docker-compose.local.yml down -v && docker compose -f ../docker-compose.local.yml up -d
```

---

## 로그인

소셜 로그인은 **카카오 / Apple / Google / LINE / Meta(Facebook)** 를 지원해요.

- **카카오**는 네이티브 앱 키가 `app/app.config.js`에 이미 설정돼 있어 별도 준비 없이 동작해요.
- **Google / LINE / Meta**는 각 콘솔에서 발급한 키를 `app/.env`(`EXPO_PUBLIC_*`)에 채워야
  실제 로그인이 됩니다. 값이 없으면 빌드는 통과하되 해당 로그인만 비활성 — 채울 키 목록은
  `app/.env.example` 참고. (⚠️ App Secret 등 비밀 값은 FE `.env`에 넣지 말 것 — 백엔드 전용)

---

## 자주 쓰는 명령어

### 앱 (`app/`)

| 명령어                 | 설명                               |
| ---------------------- | ---------------------------------- |
| `npm start`            | Expo 개발 서버 시작 (Dev Client용) |
| `npx expo run:android` | Android 네이티브 빌드 + 실행       |
| `npx expo run:ios`     | iOS 네이티브 빌드 + 실행           |
| `./ios/testflight.sh`  | iOS 빌드 → TestFlight 업로드 (fastlane) |
| `npm run lint`         | ESLint 검사                        |
| `npm run format:fix`   | Prettier 포맷 적용                 |

### 백엔드 (`back/`)

| 명령어                                          | 설명                       |
| ----------------------------------------------- | -------------------------- |
| `./gradlew bootRun`                             | 백엔드 실행                |
| `./test-local.sh`                               | 로컬 테스트 (Testcontainers) |
| `./gradlew checkstyleMain spotbugsMain test`    | CI와 동일한 검사           |
| `docker compose -f ../docker-compose.local.yml down -v` | 로컬 DB 초기화 (이후 `up -d`) |

---

## 기술 스택

### 앱

- React Native 0.86 / Expo SDK 57 / React 19
- React Navigation (Bottom Tabs)
- `@react-native-kakao/user` (카카오 로그인)
- iOS 스크린타임 익스텐션 (Swift)

### 백엔드

- Spring Boot 4 / Java 17 / Gradle
- PostgreSQL + Spring Data JPA
- JWT 인증 · WebSocket/STOMP · SpringDoc OpenAPI

---

## 개발 컨벤션

- 커밋 · PR 제목: `[TYPE] GROMO-#### 한 줄 요약` (TYPE: FEAT / FIX / CHORE / REFACTOR)
- 자세한 규칙은 각 `CLAUDE.md`를, CI/CD 파이프라인은 `.github/workflows/`를 참고하세요.
