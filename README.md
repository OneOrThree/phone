# gromo

집중한 시간으로 캐릭터를 키우는 시간 관리 앱입니다.
**Spring Boot 4 REST API**(`server/data-api/`)와 React Native(Expo) 앱을 한 저장소에서 관리하는 모노레포입니다.

| | |
| --- | --- |
| 회사 · 앱 | `oneorthree` · gromo (`1.1.0`) |
| 서버 | Spring Boot `4.0.6` · Java 17 · PostgreSQL · 도메인 17종 · 컨트롤러 31 · 엔티티 44 |
| 앱 | React Native `0.86` · Expo SDK `57` · React `19.2.3` · TypeScript(strict) |
| 번들 id | iOS · Android 모두 `com.oneorthree.gromo` |
| 지원 언어 | 한국어 · English · 日本語 · 繁體中文 |
| 티켓 · 문서 | Jira `GROMO-####` · [`docs/`](docs/) |

## 한눈에 보기

```
gromo/
├── server/
│   ├── data-api/                # ★ Spring Boot 4 REST API (Java 17 + PostgreSQL)
│   │   ├── src/main/java/com/oneorthree/phone/
│   │   │   ├── <domain>/        #   도메인 17종 — 각자 controller·service·repository 를 소유
│   │   │   ├── common/          #   소유 도메인이 없는 공유물 (port·id·exception·logging)
│   │   │   └── config/          #   Spring 배선 · 서블릿 필터 · 스케줄링 · ShedLock
│   │   ├── src/main/resources/db/migration/   # Flyway V1~V50 — 스키마의 정본
│   │   ├── src/test/java/       #   테스트 클래스 199개 (Testcontainers · ArchUnit)
│   │   ├── config/checkstyle/ · config/spotbugs/
│   │   └── Dockerfile           #   멀티스테이지 · Datadog 에이전트 내장(비활성)
│   ├── observability/           # Prometheus · Grafana · Loki · Promtail · Datadog 설정
│   └── scripts/                 # docker-compose 5종 (local·dev·prod·datadog·observability)
├── app/
│   ├── app-dev/                 # React Native + Expo 앱 (TypeScript · strict)
│   │   ├── src/                 #   화면·컴포넌트·서비스·상태 (.ts/.tsx 559개)
│   │   ├── ios/                 #   네이티브 iOS 프로젝트 + 확장 타겟 6종
│   │   ├── android/             #   네이티브 Android 프로젝트
│   │   └── modules/             #   Expo 네이티브 모듈 (screen-time · subject-mask)
│   ├── assets/                  # 디자인 원본 (앱 아이콘·캐릭터 아트·영상)
│   └── scripts/                 # 로컬 웹 실행기 (local-web.sh · local-web.command)
├── loadtest/                    # k6 부하테스트 하네스 (GCP 러너 · 트리거 대시보드)
├── docs/                        # 팀 공유 문서 — prd/<기능>/ · conventions/ · app-imgs/ · qa/
└── .github/workflows/           # CI/CD 16종
```

최상위에는 그 밖에 `CLAUDE.md`(개발 가이드) · `AGENTS.md`(코드 리뷰 규칙)가 있습니다.
`doc/` · `logs/` · `app/app-dev/.docs/` 는 **개인 스크래치라 git 에 없습니다**.

프론트엔드와 백엔드는 툴링을 공유하지 않습니다. 작업할 쪽 디렉토리로 들어가면 그 하위의
`CLAUDE.md` 가 적용됩니다 — [서버](server/data-api/CLAUDE.md) · [앱](app/app-dev/.claude/CLAUDE.md).

---

# 서버 — `server/data-api/`

Spring Boot **4.0.6** / Java 17 / Gradle. PostgreSQL 단일 인스턴스에 붙는 REST API 하나이고,
`:8080` 으로 API 를, `:9091` 로 관리 엔드포인트를 엽니다.

## 요청이 지나가는 길

```
클라이언트
   │  HTTPS
   ▼
┌─ 서블릿 필터 체인 ────────────────────────────────────────────┐
│ order 0  RequestSizeLimitFilter   경로별 본문 크기 상한         │
│ order 1  JwtFilter                /api/* 전용 · access 토큰만   │
│ order 2  TraceIdFilter            traceId 를 MDC 에 심음        │
└──────────────────────────────────────────────────────────────┘
   ▼
XxxController          @LoginUser 로 인증 주체를 파라미터로 받음
   │                   Swagger 애노테이션은 XxxControllerDocs 인터페이스로 분리
   ▼
XxxService             비즈니스 로직 · @Transactional 경계
   │
   ├─→ XxxQueryService   id 조회 — 소프트딜리트 필터 · 락 선택 · not-found 예외를 한 곳에
   ├─→ XxxRepository     프로젝션 · 범위 스캔 · 검색 · 쓰기
   └─→ common/port/*     외부로 나가는 구멍 (FCM · 스크린타임 알림 · 초대 어트리뷰션)
   ▼
PostgreSQL             스키마의 정본은 Flyway 마이그레이션
```

- 예외는 도메인별 `XxxException`(+`XxxErrorCode`)로 던지고 `common/exception/GlobalExceptionHandler`
  가 한 곳에서 `ErrorResponse` 로 바꿉니다.
- 응답 문서는 SpringDoc 이 런타임에 생성합니다 — <http://localhost:8080/swagger-ui/index.html>.

## 도메인 레이어 — 문서가 아니라 테스트가 지킵니다

패키지는 **계층이 아니라 도메인 단위**로 나뉩니다. 그리고 도메인 사이의 참조 방향은
`src/test/.../architecture/DomainLayerRulesTest` 가 **ArchUnit 으로 강제**합니다.
「사실은 아래에, 그 사실에 반응·조립하는 것은 위에」 — 참조는 **위에서 아래로만** 가고, 같은 층끼리도 금지입니다.

| 층 | 도메인 | 뜻 |
| --- | --- | --- |
| 0 | `user` | 계정 — 아무도 참조하지 않습니다 |
| 1 | `currency` · `item` | 유저에게 달린 원장·보유 |
| 2 | `focus` · `screentime` | 유저가 만든 기록 |
| 3 | `friend` | 유저 사이의 관계 |
| 4 | `stats` · `league` | 기록·관계의 집계 |
| 5 | `group` | 모임 · 챌린지 · 내기 |
| 6 | `invitelink` | 그룹을 가리키는 초대 |
| 7 | `notification` | 전 도메인 구독 |
| 8 | `auth` · `character` · `bot` · `analytics` | 진입 · 부가 |
| 9 | `profile` · `withdrawal` | 조립 — 영속성 없음 |

`common` · `config` 는 레이어 밖이라 누구나 참조할 수 있습니다.
테스트는 세 가지를 검사합니다 — **모든 도메인이 레이어 표에 등록돼 있을 것**(미등록은 침묵이 아니라 실패),
**참조는 아래로만**, **도메인 사이에 순환 없음**. 규칙의 정본은
[`docs/conventions/backend-layering.md`](docs/conventions/backend-layering.md) §4 이고 위 표는 그것을 코드로 옮긴 것입니다.

> 문서만으로 지키던 시절엔 참조 하나를 거꾸로 추가해도 컴파일러도 테스트도 잡지 못했습니다.
> 이 테스트가 그 자리를 메웁니다.

### 도메인이 하는 일

| 도메인 | 역할 |
| --- | --- |
| `auth` | 소셜 로그인 6종 구현 · JWT 발급/갱신 · 게스트 계정 |
| `user` · `profile` · `withdrawal` | 계정 · 프로필 · 준비시험(occupation) · 탈퇴(PII 파기 + 소프트딜리트) |
| `focus` | 집중 세션 시작/종료 · 고아 세션 자동 마감 |
| `screentime` | 기기 스크린타임 리포트 수집 |
| `stats` | 집중·스크린타임 통계 집계 (영속 계층 없음 — 다른 도메인을 읽어 조립) |
| `group` | 그룹 · 공지 · 멤버 · 챌린지 · 내기 · 참가비 정산 · 결과 확인 |
| `league` | 리그 · 티어 · 랭킹 · 주간 정산 |
| `bot` | 리그 봇 시뮬레이터 |
| `friend` | 친구 · 요청 · 고정(핀) |
| `invitelink` | 초대 링크 발급/해석 · 공개 랜딩 · `.well-known`(AASA) |
| `character` · `item` | 캐릭터 · 상점 아이템 · 인벤토리 · 장착 |
| `currency` | 인게임 재화 원장 |
| `notification` | 알림 생성 · FCM 푸시 발송 |
| `analytics` | 이벤트 수집 · GA4 전송 (영속 계층 없음) |

### 규모 (2026-09-11 실측)

| 항목 | 수 | 집계 기준 |
| --- | --- | --- |
| 도메인 패키지 | 17 | `com/oneorthree/phone/` 1-depth (`common`·`config` 제외) |
| 컨트롤러 | 31 | 파일명 `*Controller.java` (`*ControllerDocs.java` 제외) |
| 엔티티 | 44 | 줄 첫머리 `@Entity` — 단순 `grep @Entity` 는 `@EntityGraph` 3건을 함께 세어 47이 됩니다 |
| 스프링 서비스 빈 | 58 | `@Service` 애노테이션. 그중 파일명이 `*Service.java` 인 것은 54(`*QueryService` 7 포함)이고, 나머지는 `LeagueUserSettler`·`GroupBetSettler`·`BotSimulator` 처럼 이름이 역할을 말하는 클래스입니다 |
| `ErrorCode` enum | 12 | `implements ErrorCode` |
| 테스트 클래스 | 199 | `src/test/java` 의 `*Test.java` — 그 밖에 `PhoneApplicationTests` 1개가 더 있습니다 |
| Flyway 마이그레이션 | 49 | `V1`~`V50` (V24 결번) |
| ShedLock 잠금 잡 | 22 | `@SchedulerLock(name = …)` |

### 패키지 표준 레이아웃

```
com.oneorthree.phone.<domain>/
├── XxxController.java          컨트롤러 — 도메인 루트에 평평하게
├── XxxControllerDocs.java      Swagger 애노테이션 전용 인터페이스
├── dto/          요청·응답 타입 (API 계약)
├── service/      비즈니스 로직 · 트랜잭션 경계
├── support/      순수 헬퍼·정책·계산기 (주입받는 리포지토리·서비스 없음)
├── repository/   Spring Data 인터페이스 + XxxQueryService(조회 계층)
│   └── domain/   @Entity · 영속 enum
├── event/ · listener/ · client/ · scheduler/ · exception/   (해당할 때만)
```

**목록에 없는 이름(`util/`·`handler/`·`facade/`·`policy/`)은 새로 만들지 않습니다** — 계층이 이름에 드러나지 않기 때문입니다.
엔티티가 `repository/domain/` 에 있는 이유는 `@Entity`·`@Table`·페치 전략이 박힌 **영속성 계층의 산물**이기 때문입니다.
도메인 최상위에 두면 "순수 도메인 모델"이라는 거짓 신호를 줍니다.

## 영속 — 스키마의 정본은 Flyway

| | |
| --- | --- |
| 마이그레이션 | `src/main/resources/db/migration/` — **V1~V50** (파일 49개, V24 결번) |
| dev/prod 기동 | `spring.jpa.hibernate.ddl-auto: validate` — **엔티티↔DB 드리프트면 기동을 거부**합니다 |
| dev 특례 | `baseline-on-migrate` + `out-of-order: true` — 병렬 브랜치에서 번호가 역전 도착하는 dev 특성 대응. prod 는 미적용 |
| PK | **UUID v7** — `@GeneratedUuidV7`(`common/id`). 시간 정렬이라 B-tree 인덱스 지역성이 좋습니다 |
| 조회 | id 조회는 리포지토리가 아니라 `<domain>/repository/<Domain>QueryService` 를 거칩니다 |
| DBML | `server/data-api/docs/db/schema.dbml` — **git 추적 대상**. 마이그레이션과 같은 커밋에 담습니다 |

> ⚠️ **CI 는 마이그레이션을 돌리지 않습니다.** 테스트는 `create-drop` 으로 뜨기 때문에
> 엔티티↔DDL 드리프트는 dev/prod 부팅에서만 드러납니다. 마이그레이션 번호는 **열린 PR 까지 확인**하고 잡으세요.

`QueryService` 는 시그니처로 두 가지를 감추지 않습니다 — **락**(`…ForShare` / `…ForUpdate`)과
**"대상이 없다"와 "호출자가 없다"의 구분**. 프로젝션·범위 스캔·검색·쓰기는 여전히 리포지토리를 직접 부릅니다.

## 인증

`config/JwtFilter` 가 **`/api/*` 만** 필터합니다. JJWT 0.12 로 서명·검증하고, 비밀번호는
`spring-security-crypto` 의 BCrypt 만 씁니다(`spring-boot-starter-security` 미도입).

- **access 타입만 통과합니다.** 장수명 refresh 토큰이 `/api/*` 를 직접 인증하던 경로를 막았습니다.
- 화이트리스트는 로그인·재발급 엔드포인트 9개 — `startsWith` 접두 매칭입니다.
- 인증 주체는 `common/auth/LoginUserArgumentResolver` 가 `@LoginUser` 파라미터로 꽂아 줍니다.
- 수명은 프로파일마다 다릅니다 — dev access 30일(디버깅 편의), prod 1시간. **게스트 refresh 는 90일**이며,
  소셜과 달리 게스트는 만료되면 돌아갈 곳이 없어 사실상 "이 기간 안 켜면 계정 삭제"입니다.

| 제공자 | 검증 방식 |
| --- | --- |
| Apple · Google · Meta(Facebook) | JWKS 로 `id_token` 서명 검증 |
| 카카오 · LINE · Instagram | 제공자 API 호출로 토큰 검증 |
| 게스트 | 서버가 바로 access+refresh 발급 (레이트리밋 있음) |

> 서버는 **6종을 구현**했고 앱이 현재 노출하는 것은 Instagram 을 뺀 **5종**입니다.

## 스케줄링 — 인스턴스가 여럿이어도 한 번만

`@Scheduled` 진입점은 도메인의 `scheduler/` 패키지에 있습니다 — `group` · `notification` ·
`league` · `focus` · `bot` 다섯 곳. 모든 잡은 **ShedLock**(PostgreSQL `shedlock` 테이블, V45)으로
잠그기 때문에 dev/prod 인스턴스가 여러 대여도 한 번만 돕니다.

현재 잠긴 잡 **22개**:

| 도메인 | 잡 |
| --- | --- |
| `group` | `group-bet-ensure-today-sessions` · `group-bet-settle-scan` · `group-bet-freeze-monitor` · `group-bet-void-short-sessions` |
| `league` | `league-weekly-batch` |
| `focus` | `focus-orphan-sweep` |
| `bot` | `bot-simulator-tick` |
| `notification` | `notification-bet-event-flush` · `-bet-event-rescan` · `-silent-flush` · `-challenge-duration-end` · `-challenge-window-end` · `-league-deadline` · `-league-final-deadline` · `-league-relegation-warning` · `-league-sunday-crisis` · `-league-weekly-results` · `-missed-focus-today` · `-session-open` · `-streak-at-risk` · `-inactive-return` · `-rank-overtake` |

`config/SchedulingConfig` · `AsyncConfig` · `NotificationAsyncConfig` 가 스레드풀을 나눠,
알림 발송이 다른 배치를 굶기지 않게 합니다. 시각은 `ClockConfig` 가 주입하는 `Clock` 으로 읽어
테스트에서 시간을 고정할 수 있습니다.

## 나가는 구멍 — 포트/어댑터

외부로 나가는 호출은 `common/port/` 의 인터페이스 뒤에 둡니다. 기본 구현이 **NoOp** 이라
로컬·CI 에서 외부 의존 없이 뜹니다.

| 포트 | 구현 |
| --- | --- |
| `PushNotificationPort` | **FCM HTTP v1** — `google-auth-library-oauth2-http` 로 서비스 계정 OAuth2 토큰 발급 (firebase-admin 미도입) |
| `ScreenTimeNotificationPort` | 스크린타임 관련 알림 |
| `InviteAttributionPort` | 초대 링크 어트리뷰션 |
| `EarlyWinConfirmationPort` | 챌린지 조기 확정 |
| `Ga4MeasurementClient` (`common/analytics`) | GA4 Measurement Protocol |

## 예외 계약

```
ErrorCode (인터페이스)  ←  <Domain>ErrorCode enum  (도메인마다 하나, 현재 12개)
DomainException         ←  <Domain>Exception
        ▼
GlobalExceptionHandler  →  ErrorResponse / RetryAfterErrorResponse
```

`ErrorContractTest` 가 ArchUnit 으로 **모든 도메인 예외가 실제로 핸들러에 물려 있는지**를 검사합니다 —
새 예외를 만들고 핸들러 등록을 잊으면 테스트가 잡습니다.

## 관측

| 층 | 무엇 |
| --- | --- |
| 메트릭 | Actuator + micrometer-registry-prometheus. `http.server.requests`·HikariCP 풀·JVM 자동 계측, p95/p99 용 히스토그램 버킷 활성 |
| **포트 격리** | 관리 엔드포인트는 공개 `8080` 이 아닌 **내부 전용 `9091`** 로 뺍니다. `JwtFilter` 는 `/api/*` 만 필터하므로 `/actuator/*` 는 무인증 — 포트를 안 열어서 막습니다. 노출은 `health,info,prometheus` 뿐 |
| 구조화 로그 | `logstash-logback-encoder` 로 **BIZEVENT** JSON 로그. `MaskingConverter` 가 민감값을 가립니다 |
| 활동 이벤트 | `common/logging/UserActivityEventLogger` — `last_active_at` 갱신은 2시간 스로틀 창 |
| 추적 | `TraceIdFilter` 가 요청마다 traceId 를 MDC 에 심어 로그를 꿰맵니다 |
| 쿼리 | `p6spy-spring-boot-starter` (dev 는 로깅 off, 필요할 때 켬) |
| APM | Datadog 에이전트가 **이미지에 구워져 있고 평소엔 비활성** — overlay 가 `-javaagent` 로 켤 때만 로드 |
| 셀프호스트 | Prometheus · Grafana · Loki · Promtail — [`server/observability/`](server/observability/README.md) |

## 품질 게이트

로컬에서 `./gradlew checkstyleMain spotbugsMain test` 가 CI 와 같은 검사입니다.

| 도구 | 버전 | 정책 |
| --- | --- | --- |
| Checkstyle | 10.21.4 | `ignoreFailures = false` — 위반이면 빌드 실패 (main 소스만) |
| SpotBugs | 4.8.6 | `effort = max`, **HIGH 이상만 빌드 실패**. MEDIUM 은 리포트에만 |
| JaCoCo | 0.8.12 | XML(CI 파싱) + HTML(로컬 열람) |
| OWASP Dependency-Check | 10.0.4 | **CVSS 9.0+(Critical)만 빌드 실패**. HIGH/MEDIUM 은 PR 리포트에 경고 |
| Testcontainers | 1.20.1 | 실제 `postgres` 컨테이너로 테스트 (`./test-local.sh` 는 `postgres:16-alpine` 을 띄웠다 지웁니다) |
| ArchUnit | 1.3.0 | 도메인 레이어 규칙 · 예외 계약 (평범한 `@Test` + `ClassFileImporter` — junit5 러너 불필요) |

PR 에는 `dev-ci.yml` 의 `pr-report` 잡이 위 리포트를 파싱해 코멘트로 붙입니다.

## 이미지와 배포

`Dockerfile` 은 멀티스테이지입니다.

- **builder 는 `$BUILDPLATFORM`(빌드 머신 네이티브)에서 돕니다** — Gradle 을 QEMU 에뮬레이션 없이 돌리고,
  산출 JAR 는 아키텍처 무관이라 최종 스테이지만 타깃 아키텍처 JRE 로 조립합니다.
- 베이스는 `eclipse-temurin:17-*-jammy` — **alpine 태그는 amd64 전용**이라 AWS `t4g`(arm64)·Apple Silicon 을 못 씁니다.
- 의존성 해석 레이어를 소스 COPY 보다 먼저 두어, 소스만 바뀐 반복 빌드에서 재다운로드를 건너뜁니다.
- Datadog 에이전트는 버전 고정 + **sha256 체크섬 핀**으로 받습니다(공급망 무결성).
- Datadog Autodiscovery 설정을 **이미지 라벨에 구워** dev·prod 가 같은 배선을 갖게 했습니다 —
  prod 는 레포를 체크아웃하지 않아 마운트할 설정 파일이 없기 때문입니다.

| 환경 | 흐름 |
| --- | --- |
| **dev** | `main` push → `dev-ci.yml` 이 검사·빌드 후 GAR 에 `back:<sha>` push → `dev-cd.yml` 호출 → AWS `ap-northeast-2` 배포 (OIDC 키리스, 런타임 시크릿은 Secrets Manager `gromo/dev/env`) → `/health` 확인 |
| **prod** | `release` push → `prod-ci.yml` 빌드·푸시 → `prod-cd.yml` 배포(compose 만 S3 로) → 문제 시 `prod-rollback.yml` |

## 프로파일

설정 파일은 `local` · `dev` · `ci` · `prod` · `loadtest` 5종입니다
(`src/main/resources/application-*.yml`, `local` 만 `.example` 에서 복사).
테스트는 `ci` 프로파일에서 돕니다. `staging` 은 코드의 `@Profile` 게이팅에만 등장하고 아직 설정 파일이 없습니다.

---

# 앱 — `app/app-dev/`

React Native `0.86` / Expo SDK `57` / React `19.2.3`, TypeScript strict. iOS 최소 지원 **16.4**.

```
app/app-dev/src/
├── App.tsx          인증·온보딩 게이팅 + Provider 중첩만 담당
├── navigation/      RootNavigator · 탭(홈·리그·그룹·전체) · 라우트 타입
├── screens/         character · currency · focus · group · league · onboarding · settings · stats
├── components/      공용 컴포넌트 (character/ 포함)
├── services/        api.ts(axios) · ScreenTimeModule.ts · 도메인별 API 래퍼
├── store/ · hooks/  Context API + hooks (Redux/MobX/Zustand 없음)
├── constants/       theme.ts — 디자인 토큰 `T` 와 inkBox()
├── i18n/locales/    ko · en · ja · zh-Hant
└── types/           api.ts(공용 DTO) · storage.ts · dto/
```

- **백엔드 호출은 원칙적으로 `src/services/api.ts` 의 axios 인스턴스를 거칩니다** — JWT 주입과
  401 재발급 재시도가 여기 한 곳에 있습니다. 인터셉터를 **일부러 우회하는 예외 셋**이 있습니다:
  소셜·게스트 로그인과 로그아웃(`services/auth.ts`), 디바이스 토큰 삭제(`services/userApi.ts`),
  그리고 `api.ts` 자신의 `doRefreshAccessToken` — 401 인터셉터 재귀·데드락을 피하려고 맨 `axios` 를 씁니다.
- 전역 상태는 Context + hooks 이며 `UserProvider › CoinProvider › EquipmentProvider ›
  FocusProvider › SubjectProvider` 순으로 중첩됩니다. AsyncStorage 로 영속화하고 서버와 동기화합니다.
- iOS 는 메인 타겟 외에 확장 타겟 6종을 함께 빌드합니다 — `screentimereport` · `GromoScreenTimeMonitor` ·
  `ShieldConfiguration` · `ShieldAction` · `NotificationService` · `Widget`.

## 앱 ↔ 서버

```
 iOS Screen Time  ─┐
 Android 사용량   ─┴─→ 네이티브 모듈 ─→ 화면 ─→ services/api.ts (axios + JWT)
                                                       │ HTTPS
                                                       ▼
                              server/data-api  :8080 (/health) · :9091 (actuator)
                                Controller → Service → QueryService/Repository → PostgreSQL
                                     │                                              ▲
                                     ├─ @Scheduled + ShedLock (정산·판정·알림 22잡) ─┘
                                     └─ FCM HTTP v1 ─→ 푸시 ─→ 앱

   Flyway V1~V50 ─→ PostgreSQL 스키마 = 단일 진실 공급원
   Actuator/micrometer :9091 ─→ Prometheus·Grafana·Loki / Datadog APM·RUM
```

> 앱↔서버는 **REST 단방향 + 푸시**입니다. 실시간 소켓 채널은 없습니다.

---

## 시작하기 — 백엔드

### 사전 준비

- Java 17
- Docker (로컬 PostgreSQL · Testcontainers 용)

### 실행

```bash
cd server/data-api
docker compose -f ../scripts/docker-compose.local.yml up -d   # 로컬 PostgreSQL

# 최초 1회: 로컬 설정 파일 생성 (gitignore됨 — Flyway 비활성 등 로컬 기본값 포함)
cp src/main/resources/application-local.yml.example src/main/resources/application-local.yml

./gradlew bootRun
```

- API: <http://localhost:8080>
- 헬스체크: <http://localhost:8080/health>
- Swagger UI: <http://localhost:8080/swagger-ui/index.html>

### 테스트 · 코드 검사

```bash
./test-local.sh                                  # Testcontainers 기반 테스트 (postgres:16-alpine)
./gradlew checkstyleMain spotbugsMain test       # CI와 동일한 검사
./gradlew jacocoTestReport                       # 커버리지 리포트

# 로컬 DB 초기화 (볼륨 삭제 → 새 DB)
docker compose -f ../scripts/docker-compose.local.yml down -v && docker compose -f ../scripts/docker-compose.local.yml up -d
```

### DB 스키마 변경

1. `src/main/resources/db/migration/V<N+1>__<설명>.sql` 추가 — **번호는 열린 PR 까지 확인**하고 잡습니다.
2. `docs/db/schema.dbml` 갱신 — 마이그레이션과 **같은 커밋**에 담습니다.
3. PR 본문의 "DB 변경" 항목을 채웁니다.

---

## 시작하기 — 앱

### 사전 준비

- [Node.js 24+](https://nodejs.org)
- Android Studio 또는 Xcode (에뮬레이터/시뮬레이터)
- iOS 빌드 시 [CocoaPods](https://cocoapods.org) (`pod install`용)
- TestFlight 배포 시 Ruby + Bundler (fastlane용 — 아래 [TestFlight 배포](#testflight-배포) 참고)
- 또는 실기기 + [Expo Dev Client](https://docs.expo.dev/develop/development-builds/introduction/)

### 설치 및 실행

```bash
cd app/app-dev
npm install
cp .env.example .env             # 환경변수 파일 생성 (아래에서 API 서버 지정)
cd ios && pod install && cd ..   # iOS 네이티브 의존성 (CocoaPods 필요)

npx expo start                   # 개발 서버 시작
```

`.env`의 `EXPO_PUBLIC_API_URL`로 붙을 백엔드를 정해요.

- **팀 서버(기본·권장)**: `EXPO_PUBLIC_API_URL=https://xxxxxxxxxx.com` — 백엔드 셋업 불필요
- **로컬 백엔드**: `server/data-api/`를 띄운 뒤 `EXPO_PUBLIC_API_URL=http://localhost:8080` (실기기는 Mac의 LAN IP 사용)

> 실기기 Metro 용 `REACT_NATIVE_PACKAGER_HOSTNAME` 은 `.env` 가 아니라 **`.env.local`** 에 넣습니다.
> SDK 57 부터 머신별 개인 환경변수를 `.env` 에 두면 빌드가 거부됩니다(@expo/env 정책).

### 웹 디버깅

웹 개발 서버는 운영 API URL이 환경변수에 있어도 항상 로컬 백엔드(`localhost:8080`)를
사용합니다. 웹 배포 번들은 항상 팀 dev API를 사용합니다.

`app/scripts/local-web.command`를 더블클릭하거나 아래 명령 하나만 실행합니다.

```bash
./app/scripts/local-web.command
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

> ⚠️ **`expo prebuild` 는 돌리지 않습니다.** `ios/` 는 프리빌드된 상태로 커밋돼 있고,
> prebuild 는 `react-native-line` 에서 깨지면서 `pbxproj`·`Info.plist` 를 망가뜨립니다.

### TestFlight 배포

**로컬 fastlane**으로 TestFlight에 올려요. 셋업이 끝나 있으면 아래 한 방이면 됩니다.
(빌드는 macOS + Xcode 필요)

```bash
cd app/app-dev/ios
./testflight.sh
```

**최초 1회 셋업** (이미 되어 있으면 생략)

1. **fastlane 설치** — 전역 설치 대신 Gemfile(번들러)로 관리해요.
   ```bash
   cd app/app-dev/ios
   bundle install       # Gemfile 의 fastlane 설치 (Ruby·Bundler 필요)
   ```
2. **인증** — App Store Connect API Key(`.p8`)로 로그인해요.
   `app/app-dev/ios/fastlane/.env`(gitignore됨)에 아래 3개를 넣어둡니다.
   ```bash
   ASC_KEY_ID=XXXXXXXXXX          # AuthKey_XXXXXXXXXX.p8 의 키 ID
   ASC_ISSUER_ID=xxxxxxxx-....    # ASC → 사용자 및 액세스 → 통합(Integrations) 상단
   ASC_KEY_PATH=/절대경로/AuthKey_XXXXXXXXXX.p8
   ```
3. **서명** — 개인 Apple 계정의 distribution p12 인증서 + 7개 타겟용
   `distribution-gromo-*` 프로비저닝 프로파일(수동 서명)이 키체인/Xcode에 설치돼 있어야 해요.

> 자주 막히는 곳(codesign `errSecInternalComponent`, Pods sync 등)과 서명 셋업 상세는
> `app/app-dev/.claude/CLAUDE.md` 및 관련 WorkLog을 참고하세요.

---

## 로그인

소셜 로그인은 **카카오 / Apple / Google / LINE / Meta(Facebook)** 를 지원해요.

- **카카오**는 네이티브 앱 키가 `app/app-dev/app.config.js`에 이미 설정돼 있어 별도 준비 없이 동작해요.
- **Google / LINE / Meta**는 각 콘솔에서 발급한 키를 `app/app-dev/.env`(`EXPO_PUBLIC_*`)에 채워야
  실제 로그인이 됩니다. 값이 없으면 빌드는 통과하되 해당 로그인만 비활성 — 채울 키 목록은
  `app/app-dev/.env.example` 참고. (⚠️ App Secret 등 비밀 값은 FE `.env`에 넣지 말 것 — 백엔드 전용)

---

## 자주 쓰는 명령어

### 백엔드 (`server/data-api/`)

| 명령어                                          | 설명                       |
| ----------------------------------------------- | -------------------------- |
| `./gradlew bootRun`                             | 백엔드 실행                |
| `./test-local.sh`                               | 로컬 테스트 (Testcontainers) |
| `./gradlew checkstyleMain spotbugsMain test`    | CI와 동일한 검사           |
| `./gradlew jacocoTestReport`                    | 커버리지 리포트            |
| `./gradlew dependencyCheckAnalyze`              | OWASP 취약점 스캔          |
| `./gradlew bootJar`                             | 실행 가능 JAR 빌드         |
| `docker compose -f ../scripts/docker-compose.local.yml down -v` | 로컬 DB 초기화 (이후 `up -d`) |

### 앱 (`app/app-dev/`)

| 명령어                 | 설명                               |
| ---------------------- | ---------------------------------- |
| `npm start`            | Expo 개발 서버 시작 (Dev Client용) |
| `npx expo run:android` | Android 네이티브 빌드 + 실행       |
| `npx expo run:ios`     | iOS 네이티브 빌드 + 실행           |
| `./ios/testflight.sh`  | iOS 빌드 → TestFlight 업로드 (fastlane) |
| `npm run lint`         | ESLint 검사                        |
| `npm run format:fix`   | Prettier 포맷 적용                 |
| `npm run typecheck`    | `tsc --noEmit` 타입 검사           |
| `npm test`             | Jest (테스트 파일 195개)           |
| `./scripts/e2e.sh`     | Maestro E2E — Release 시뮬 빌드 후 `.maestro/flows/` 01→02→03 |

---

## 기술 스택

### 백엔드

| 축 | 채택 |
| --- | --- |
| 프레임워크 | Spring Boot `4.0.6` · Spring Web/MVC · Java 17 toolchain · Gradle |
| 영속 | PostgreSQL · Spring Data JPA(Hibernate) · **Flyway**(+`flyway-database-postgresql`) · UUID v7 PK(`java-uuid-generator`) |
| 인증 | JJWT `0.12.6` · BCrypt(`spring-security-crypto` 단독) · 소셜 6종 JWKS/API 검증 |
| 스케줄링 | `@Scheduled` + **ShedLock `5.16`**(jdbc-template provider) |
| 푸시 | FCM HTTP v1 — `google-auth-library-oauth2-http` (firebase-admin 미도입) |
| 문서화 | SpringDoc OpenAPI `3.0.2` + `openapi-gradle-plugin` (CI 에서 스펙 생성) |
| 관측 | Actuator + micrometer-prometheus(:9091 격리) · `logstash-logback-encoder`(BIZEVENT) · p6spy · Datadog 에이전트 내장 |
| 품질 | Checkstyle `10.21.4` · SpotBugs `4.8.6` · JaCoCo `0.8.12` · OWASP Dependency-Check `10.0.4` · **ArchUnit `1.3.0`** · Testcontainers `1.20.1` |
| 보일러플레이트 | Lombok |

> `spring-boot-starter-websocket` 이 의존성에 선언돼 있으나 **구현 코드는 없습니다**(사용처 0건).
> 실시간 채널이 필요해지면 그때 배선합니다.

### 앱

| 축 | 채택 |
| --- | --- |
| 프레임워크 | React Native `0.86.0` · Expo SDK `57` · React `19.2.3` · TypeScript(strict) |
| 네비게이션 | React Navigation 6 — Bottom Tabs + Native Stack |
| 상태 | Context API + hooks · AsyncStorage |
| 네트워크 | axios (`src/services/api.ts` 단일 인스턴스) |
| 애니메이션 | Reanimated 4 · react-native-worklets · react-native-svg |
| 로그인 SDK | `@react-native-kakao/user` · expo-apple-authentication · Google Sign-In · LINE · FBSDK |
| 알림·관측 | Firebase Messaging/Analytics · Sentry · Datadog RUM |
| OTA | `@hot-updater/react-native` |
| 네이티브 | iOS Screen Time 확장(Swift) · Expo 네이티브 모듈 2종 |

---

## CI/CD

파이프라인은 **경로 필터**로 갈립니다 — `server/data-api/**` 변경과 `app/app-dev/**` 변경은
서로 다른 잡을 깨웁니다. 아래 표는 스냅샷이라 낡을 수 있고, 정본은 `.github/workflows/` 각 파일의 `name:` 입니다.

| 워크플로 | 트리거 | 하는 일 |
| --- | --- | --- |
| `dev-ci.yml` | `server/data-api/**` PR · `main` push | checkstyle·spotbugs·test → 이미지 빌드 → (`main`) GAR push → `dev-cd` 호출 → PR 리포트 코멘트 |
| `be-check-style.yml` · `be-test.yml` · `be-spot-bugs.yml` | `workflow_call` | `dev-ci` 가 부르는 재사용 잡 (Checkstyle · JUnit+Testcontainers · SpotBugs) |
| `dev-cd.yml` | `workflow_call` | AWS dev 배포 (OIDC · `ap-northeast-2` · Secrets Manager `gromo/dev/env`) → `/health` 확인 |
| `prod-ci.yml` | `release` PR·push | 검증 + 이미지 빌드·푸시 |
| `prod-cd.yml` | `workflow_run` · 수동 | prod 배포 (compose S3 업로드 후 롤아웃) |
| `prod-rollback.yml` | 수동 | prod 롤백 |
| `api-dog-generate.yml` | `main`·`release`·`bfeat/bfix/brefactor` push | OpenAPI 스펙 생성 (`bchore` 제외) |
| `api-docs-cleanup.yml` | 브랜치 삭제 | 문서 정리 — ⚠️ 현재 **no-op**(ref 프리픽스 조건 불일치, 알려진 갭) |
| `app-lint.yml` | `app/app-dev/**` | ESLint · Prettier · `tsc` · Jest |
| `app-android-build.yml` | 네이티브 영향 경로 | Android 빌드 검증 |
| `dev-datadog.yml` · `dev-monitor.yml` | 수동 | Datadog APM 토글 · Prometheus/Grafana/Loki 스택 |
| `loadtest.yml` | 수동 | 프로필·시나리오 지정 부하테스트 |
| `claude-review.yml` | `@claude` 코멘트 | PR 리뷰 |

**iOS 빌드·배포는 CI 에 없습니다** — `app/app-dev/ios/fastlane/` 의 `beta` 레인(아카이브 → TestFlight)으로 수동 실행합니다.

---

## Git 컨벤션

### 브랜치 전략

```
b{feat,fix,refactor,chore}/   백엔드  ─┐
a{feat,fix,refactor,chore}/   앱      ─┤
{feat,fix,refactor,chore}/    공통    ─┼─→  main  ─→  release  ──(prod 배포)
doc/                          문서    ─┘   (통합)      (릴리스)
```

- **접두는 `<영역><종류>/`** — 종류는 `feat`·`fix`·`refactor`·`chore` 넷입니다.
- **백엔드 작업엔 `b`, 앱 작업엔 `a` 를 앞에 붙입니다.** 백엔드 리팩터는 `brefactor/` 이지 `refactor/` 가 아닙니다.
- 맨 접두(`feat/`·`fix/`·`refactor/`·`chore/`)는 **어느 쪽도 아닌 공통·툴링 작업 전용**입니다.
- 문서(`docs/`) 작업은 `doc/` — 신규 `doc/prd-<기능>`, 수정 `doc/fix-prd-<기능>`.

| 예 | 뜻 |
| --- | --- |
| `bfeat/GROMO-1658-kafka-events` | 백엔드 기능 |
| `brefactor/GROMO-1655-group-query-service` | 백엔드 리팩터 |
| `bchore/GROMO-1724-archunit-layer-rules` | 백엔드 잡무 |
| `afix/GROMO-1601-confetti-ota` | 앱 버그 수정 |
| `doc/prd-challenge` | 문서 신규 |

> **브랜치는 만들자마자 origin 에 올립니다.** `.claude/settings.json` 의 PostToolUse 훅이
> `checkout -b`/`switch -c` 뒤에 `git push -u origin <브랜치>` 를 자동 실행합니다.
> 이건 브랜치 생성의 일부이지 내용 push 가 아닙니다.

### 커밋 · PR 제목

```
[TYPE] GROMO-#### 한 줄 요약
```

- **TYPE** — `FEAT` · `FIX` · `CHORE` · `REFACTOR`
- **GROMO-####** — 이 PR 이 **직접 구현하는** Jira 티켓. 전체 키를 쓰면 Jira 연동이 PR 이력을 그 티켓에 붙입니다.
- **참고용 티켓은 번호만** 씁니다 (`GROMO-455` ❌ → "티켓 455" ⭕). 전체 키를 쓰면 구현하지도 않은 티켓에 이력이 붙습니다.
- 본문·PR 텍스트·코드 주석은 **한국어**로 씁니다. 코드 식별자(타입·함수·변수)만 영어입니다.

```
[FEAT] GROMO-206 인게임 재화 관리 기능 구현
[FIX] GROMO-232 TAG 삭제 시 FocusSession cascade 삭제
[CHORE] GROMO-203 디렉토리 구조 변경
[REFACTOR] GROMO-210 FocusService 로직 분리
```

### PR

- 본문은 [`.github/pull_request_template.md`](.github/pull_request_template.md) 를 따릅니다 — Jira 링크 · 변경 유형 · Summary · 커밋 목록 · Changes · 빌드/배포 영향 · **DB 변경** · 주의사항.
- **PR 은 ready 로 엽니다.** draft 에는 자동 리뷰어가 붙지 않습니다.
- assignee 를 지정하고 유형 라벨을 답니다 — `[FEAT]`→`enhancement` · `[FIX]`→`bug` · `[REFACTOR]`→`refactoring`.
- 리뷰 코멘트는 한국어로, 심각도 접두(`[필수]` / `[제안]`)를 붙입니다 — [`AGENTS.md`](AGENTS.md).

### 머지 정책

| 경계 | 방식 | 비고 |
| --- | --- | --- |
| 작업 브랜치 → `main` | **Squash** | PR 하나 = 커밋 하나. `main` 은 항상 통합 상태 |
| `main` → `release` | 릴리스 머지 | `release` push 가 prod 이미지 빌드를 깨웁니다 |

- **CI 초록만으로는 머지 승인이 아닙니다.** 리뷰 한 바퀴를 돌고 나서 머지합니다.
- Squash 머지라 스택/형제 브랜치는 원본 커밋 중복으로 충돌합니다 — `rebase --onto origin/main <원본base>` 로 떨궈 해소합니다.

### 작업 한 사이클

1. **티켓 확인** — 열린 스프린트에서 자신에게 할당된 이슈를 봅니다. 없으면 [Jira 규약](docs/conventions/jira-conventions.md)대로 먼저 만듭니다(작업·버그·Subtask 는 **`도메인` 하나 필수**).
2. **브랜치 생성 + 즉시 push** — `<영역><종류>/GROMO-####-<슬러그>`.
3. **개발** — 한 커밋에 한 논리 변경. 스키마 변경은 마이그레이션 + `schema.dbml` 을 같은 커밋에.
4. **로컬 게이트** — 서버는 `./gradlew checkstyleMain spotbugsMain test`, 앱은 `npm run lint && npm run typecheck && npm test`.
5. **`main` 대상 PR (ready)** — 템플릿을 채우고 assignee·라벨을 답니다.
6. **리뷰 반영** — 반영 push 가 다음 리뷰 라운드를 부르므로, push 뒤엔 새 코멘트를 **다시 조회**합니다.
7. **Squash 머지 → 브랜치 삭제** — 다음 작업은 갱신된 `main` 에서 새로 분기합니다.

---

## 문서 지도

| 찾는 것 | 위치 |
| --- | --- |
| **백엔드 계층·패키지 배치 규약** | [`docs/conventions/backend-layering.md`](docs/conventions/backend-layering.md) — ArchUnit 규칙의 정본 |
| **DB 스키마 정본** | `server/data-api/docs/db/schema.dbml` (추적됨) + `src/main/resources/db/migration/` |
| 백엔드 개발 가이드 | [`server/data-api/CLAUDE.md`](server/data-api/CLAUDE.md) |
| 날짜 축(로컬·KST·UTC) 규약 | [`docs/conventions/date-axis.md`](docs/conventions/date-axis.md) |
| 기능별 PRD · 정책 · IA · 설계 | [`docs/prd/<기능>/`](docs/prd/) — 구조는 [`docs/README.md`](docs/README.md) |
| Jira 4축 규약 (`도메인`·Label·Epic·fixVersion) | [`docs/conventions/jira-conventions.md`](docs/conventions/jira-conventions.md) |
| 앱 개발 가이드 | [`app/app-dev/.claude/CLAUDE.md`](app/app-dev/.claude/CLAUDE.md) |
| 부하테스트 하네스 | [`loadtest/README.md`](loadtest/README.md) |
| dev 관측 스택 | [`server/observability/README.md`](server/observability/README.md) |
| 저장소 전체 규칙 | [`CLAUDE.md`](CLAUDE.md) · 코드 리뷰 규칙 [`AGENTS.md`](AGENTS.md) |
