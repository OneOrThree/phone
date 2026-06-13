# gromo

집중 시간 관리 + 캐릭터 커스터마이징 앱
모노레포: React Native(Expo) 앱 + Spring Boot 백엔드

## 프로젝트 구조

```
gromo/
  app/    # React Native 앱 (Expo) — iOS 스크린타임 익스텐션 포함
  back/   # Spring Boot 백엔드 (Java 17 + PostgreSQL)
  docs/   # DB 스키마·설계 문서
```

> 각 디렉토리의 `CLAUDE.md`(루트 / `app` / `back`)에 개발 가이드와 컨벤션이 정리되어 있어요.

---

## 시작하기 — 앱 (`app/`)

### 사전 준비

- [Node.js 20+](https://nodejs.org) (CI는 Node 22 사용)
- Android Studio 또는 Xcode (에뮬레이터/시뮬레이터)
- 또는 실기기 + [Expo Dev Client](https://docs.expo.dev/develop/development-builds/introduction/)

> **Expo Go는 지원하지 않습니다.**
> 카카오 로그인에 네이티브 모듈(`@react-native-kakao/user`)이 필요해서
> Expo Go로는 실행이 안 돼요. Development Build를 사용해야 합니다.

### 설치 및 실행

```bash
cd app
npm install
```

**Development Build 생성 (최초 1회)**

```bash
# Android
npx expo run:android

# iOS
npx expo run:ios
```

빌드 후에는 아래 명령어로 개발 서버만 띄우면 됩니다.

```bash
npm start
```

---

## 시작하기 — 백엔드 (`back/`)

### 사전 준비

- Java 17
- Docker (로컬 PostgreSQL · 테스트 컨테이너용)

### 실행

```bash
cd back
docker compose -f ../docker-compose.local.yml up -d   # 로컬 PostgreSQL
./gradlew bootRun
```

- API: <http://localhost:8080>
- Swagger UI: <http://localhost:8080/swagger-ui/index.html>

### 테스트 · 코드 검사

```bash
./test-local.sh                                  # Testcontainers 기반 테스트
./gradlew checkstyleMain spotbugsMain test       # CI와 동일한 검사
./reset-db.sh                                    # 로컬 DB 초기화
```

---

## 로그인

카카오 로그인이 적용되어 있어요.
카카오 개발자 콘솔에서 앱 키를 발급받아 설정 파일(`app/app.config.js`)에 추가해야 합니다.

---

## 자주 쓰는 명령어

### 앱 (`app/`)

| 명령어                 | 설명                               |
| ---------------------- | ---------------------------------- |
| `npm start`            | Expo 개발 서버 시작 (Dev Client용) |
| `npx expo run:android` | Android 네이티브 빌드 + 실행       |
| `npx expo run:ios`     | iOS 네이티브 빌드 + 실행           |
| `npm run lint`         | ESLint 검사                        |
| `npm run format:fix`   | Prettier 포맷 적용                 |

### 백엔드 (`back/`)

| 명령어                                          | 설명                       |
| ----------------------------------------------- | -------------------------- |
| `./gradlew bootRun`                             | 백엔드 실행                |
| `./test-local.sh`                               | 로컬 테스트 (Testcontainers) |
| `./gradlew checkstyleMain spotbugsMain test`    | CI와 동일한 검사           |
| `./reset-db.sh`                                 | 로컬 DB 초기화             |

---

## 기술 스택

### 앱

- React Native 0.81 / Expo SDK 54 / React 19
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
