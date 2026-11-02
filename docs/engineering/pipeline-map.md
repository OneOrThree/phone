# 파이프라인 지도

이 문서는 「바꾼 경로 → PR에서 도는 것 → 머지 뒤 → 운영까지」의 정본이다. 상세 절차는 [dev V2 파이프라인](dev-v2-pipeline.md)과 [prod V2 파이프라인](prod-v2-pipeline.md)을 따른다. 용어는 [CONTEXT.md](../../CONTEXT.md)를 따른다. 워크플로 내용은 2026-11-02 main(`46d4d9c2f`)의 파일을 읽어 썼다. 켜짐·꺼짐, 레포 변수, 환경 같은 GitHub 설정은 같은 날 조회한 값이다.

**운영 보호(2026-11-02 적용, GROMO-2695)**: 운영 V2 CD(`prod-cd-V2`·`kafka-cd.prod-V2`·`redis-cd.prod-V2`)는 환경 `catus-production-V2`에서 승인자 3명 중 1명의 승인을 기다린다(본인 승인 허용). `release`는 PR로만 바뀐다 — 관리자 포함, 승인 0명, 대화 해결 필수, force push·삭제 금지([release 브랜치 보호](../conventions/release-protection.md)). release의 최근 `prod-cd-V2` 실행이 승인 대기 중이거나 성공하지 못했으면 서버 선행 게이트가 앱 출시를 막는다(§1 「예외와 주의」).

## 1. 변경 영역별 흐름

- 모든 PR에서는 경로와 상관없이 `agent-harness`가 돈다. main 대상 PR에서는 `pr-ci-policy`와 `migration-immutable`도 돈다.
- 경로 필터 목록은 각 워크플로 파일이 정본이다. dev V2 CI의 경로는 [dev V2 파이프라인 「CI」](dev-v2-pipeline.md#ci)에 있다.
- 운영은 사람이 바꾼다. main → release 같은 저장소 PR을 merge commit으로 머지하면, release push에서 `prod-ci-V2`가 산출물과 `catus-v*-V2` 태그만 발행한다. 이때 운영은 그대로다. 사람이 release에서 `prod-cd-V2`를 `version`으로 실행하고 환경 승인 1회를 거쳐야 운영 V2가 바뀐다.
- 서버 4종·Kafka·Redis의 운영 CD를 자동으로 부르는 워크플로는 없다. 백오피스만 main 머지에서 운영 배포가 시작된다(승인 1회).

| 바꾼 경로 | PR에서 | main 머지 뒤 | 운영까지 |
| --- | --- | --- | --- |
| `app/app-dev` JS·TS | `app-lint`, `app-android-ci`(계약 테스트만, AAB 없음) | `app-lint`, `app-android-ci`(서버 선행 게이트 → 운영 V2 서버용 AAB), `app-ios-testflight-dev`(2026-11-02 현재 건너뜀) | Android: `app-android-cd`가 Play internal 트랙에 자동 게시(2026-11-02 18:08 KST 다시 켜짐), 프로덕션은 Play 콘솔 승격. iOS·OTA: 로컬 `app/app-dev/ios/testflight.sh`·`app/app-dev/scripts/ota-update.sh`와 스토어 제출 |
| iOS 네이티브 `app/app-dev/ios` | `app-lint`만. iOS 컴파일 검사는 없다 | `app-lint`, `app-ios-testflight-dev`(건너뜀) | 로컬 빌드 → 스토어 |
| Android 네이티브 `app/app-dev/android`·`modules/*/android` | `app-lint`, `app-android-build`, `app-android-ci` | `app-lint`, `app-android-build`, `app-android-ci`(AAB) | `app-android-cd` → Play internal, 프로덕션은 Play 콘솔 승격 |
| `server/data-api` | `data-api-ci.dev-v2`, `satellite-ci.dev-v2`, `prod-ci-V2`, Java·`build.gradle`이면 `api-dog-generate` | `data-api-ci.dev-v2`가 GAR 이미지 발행 → `cd-auto.dev-v2`가 dev V2에 Data·Realtime 배포 → dev 스모크 | release 승격 + `prod-cd-V2`. 마이그레이션이 들면 `allow_migration=true`와 RDS 스냅샷([DB 전환이 든 V2 배포](../prd/fishcat/server-separation/deployment.md#db-전환이-든-v2-배포)) |
| `server/realtime` | `realtime-ci.dev-v2`, `data-api-ci.dev-v2`, `prod-ci-V2`. Realtime Gradle이 3번 돈다 | data-api와 같다 | data-api와 같다 |
| `server/business-api` | `satellite-ci.dev-v2`, `prod-ci-V2`, Java·`build.gradle`이면 `api-dog-generate`, `ApiErrorCode.java`면 `app-lint` | `satellite-ci.dev-v2`가 이미지 발행 → `cd-auto.dev-v2`가 dev V2에 배포 | release 승격 + `prod-cd-V2` |
| `server/notification` | `satellite-ci.dev-v2`, `prod-ci-V2` | business-api와 같다 | release 승격 + `prod-cd-V2` |
| 서버 문서 `server/<서버>/**/*.md`만 | 그 서버의 dev CI(PR 경로는 문서를 빼지 않는다) | 서버마다 다르다. data-api·business-api·notification 문서는 `satellite-ci.dev-v2` push 경로가 문서를 빼지 않아 `cd-auto.dev-v2`가 dev V2에 다시 배포한다(data-api 문서면 Realtime도). realtime 문서(`src/main/resources` 밖)는 도는 push CI가 없어 다음 realtime 배포 때 함께 간다 | 없음. 운영 계획(`catus-plan.py`)은 `.md`를 뺀다 |
| `backoffice` | `backoffice-ci` | `backoffice-ci`, `backoffice-cd.prod-V2` → `backoffice-production` 승인 1회 → 운영 배포 | dev·release 단계가 없다. `.md`가 아닌 파일의 main 머지가 곧 운영 배포다 |
| Kafka `server/scripts/v2/dev/kafka`, `server/scripts/v2/prod/kafka*` | dev 파일은 `kafka-ci.dev-v2`, prod 파일은 `kafka-ci.prod-V2`. `server/scripts/**`라 `satellite-ci.dev-v2`도 돈다 | dev 파일은 GCS 발행 → `cd-auto.dev-v2`. prod 파일은 없음 | release 승격 + `kafka-cd.prod-V2` 수동 실행 |
| Redis `server/scripts/v2/dev/redis`, `server/scripts/v2/prod/redis*` | Kafka와 같은 방식(`redis-ci.dev-v2`, `redis-ci.prod-V2`) | Kafka와 같은 방식 | release 승격 + `redis-cd.prod-V2` 수동 실행 |
| PostgreSQL `server/scripts/v2/dev/postgres` | `postgres-ci.dev-v2`, `satellite-ci.dev-v2` | GCS 발행 → `cd-auto.dev-v2` | 운영 워크플로 없음. RDS는 Infra가 관리한다. Flyway SQL은 해당 서버 행을 따른다 |
| 이미지 CDN `assets-cdn`, `scripts/assets-cdn` | `image-assets` 검사, `app-lint` | 검사·`app-lint`만 | dev CDN은 `image-assets` 수동 실행(발행·롤백). 운영 CDN은 없다 |
| 스모크 `smoke/server` | `smoke-check` | 바로 도는 것은 없다. 다음 dev 배포의 `ops-smoke.dev-v2`가 쓴다 | 운영 스모크 워크플로는 없다 |
| CI 스크립트 `.github/scripts` | `satellite-ci.dev-v2`. 운영 발행 스크립트(`catus-*`·`v2/prod/**`)면 `prod-ci-V2`도 | `satellite-ci.dev-v2` → `cd-auto.dev-v2`(서비스 지문이 같으면 배포 없음) | 운영 지문 입력이 바뀌면 다음 release 발행에서 서버 4종을 모두 다시 빌드한다 |
| 문서 `docs`, 루트 `*.md` | 상시 3개뿐: `pr-ci-policy`, `migration-immutable`, `agent-harness`. `agent-harness`가 하네스 문서의 링크·경로·워크플로 언급을 검사한다 | 없음 | 없음 |

예외와 주의:

- `server/*` 아래 `.md`도 dev 지문 입력이다. `.github/scripts/v2/dev/dev-fingerprint-V2.py`는 서비스 폴더 전체를 `git ls-tree`로 읽는다. 그래서 data-api·business-api·notification의 `.md`를 머지하면 `satellite-ci.dev-v2` → `cd-auto.dev-v2` → dev V2 재배포가 1회 돈다. data-api는 push 경로가 `.md`를 빼므로 `cd-auto.dev-v2`가 `data-api-ci.dev-v2`를 실행시켜 이미지를 만든다. realtime의 `.md`만 바뀌면 머지 때 도는 CI가 없어 다음 `cd-auto.dev-v2` 실행 때 함께 배포된다. 운영 지문(`.github/scripts/catus-plan.py`)은 `.md`와 `/docs/`를 뺀다.
- 운영 지문 입력은 `catus-plan.py`의 `SHARED`다. 이 경로가 바뀌면 모든 서비스의 지문이 함께 바뀐다.
- dev 지문 공용 입력은 `dev-fingerprint-V2.py`의 `SHARED`와 서비스별 목록이다(`be-gradle.yml`, `ci-jar`, `gar-login`, `.dockerignore`, dev V2 서버 CI 워크플로, `satellite-check.yml`, `satellite-ci-plan.py`). 이 경로가 바뀌면 머지 뒤 dev V2에 해당 서버를 다시 배포한다.
- `docs/prd/fishcat/island-movement/fixtures/**`는 문서 폴더지만 `app-lint`를 돌린다. release 대상 PR에서는 `docs/architecture/**`·`docs/contracts/**`가 `satellite-ci.prod`를 돌린다.
- 서버 선행 게이트 `.github/scripts/app-server-gate.py`는 운영 V2에 아직 배포되지 않은 서버 실행 코드가 main에 있으면 모바일 앱 출시를 막는다. 로컬 `ota-update.sh`, 운영용 `testflight.sh`, Android 운영 빌드, `app-android-ci`의 `server-gate` 잡이 부른다. 상세는 [prod V2 파이프라인 「모바일 앱 출시 순서」](prod-v2-pipeline.md#모바일-앱-출시-순서-서버-먼저-gromo-2684)를 따른다.

## 2. 워크플로

`.github/workflows/`에 은퇴하지 않은 워크플로를 더하면 `agent-harness`가 이 지도에 그 파일 이름이 없다고 실패한다. 새 워크플로는 2-1 표에 한 줄을 더한다. 폐기해 파일을 제거할 때는 2-2 표에 제거 상태와 대체 경로를 남긴다. 문서가 은퇴한 워크플로 이름을 적을 때는 같은 줄에 «V1»·«옛» 같은 표시를 쓴다.

### 2-1 살아 있는 워크플로

2026-11-02 현재 켜진 V2·공통 워크플로다.

| 영역 | 파일 | GitHub 이름 | 목적 |
| --- | --- | --- | --- |
| 공통 | [pr-ci-policy.yml](../../.github/workflows/pr-ci-policy.yml) | PR CI 정책 | main·release 대상 모든 PR(라벨·대상 변경 포함). 승격 PR 판정과 `release:*` 라벨 검사. 같은 판정 스크립트를 `prod-ci-V2`도 돈다 |
| 공통 | [migration-immutable.yml](../../.github/workflows/migration-immutable.yml) | 적용된 마이그레이션 불변 | release 대상이 아닌 모든 PR. 통합 브랜치에 들어간 Flyway 파일의 수정·삭제·개명을 막는다. `db-tools` 잡(DB 전환 도구 검사)이 `server/data-api/docs/db/test-*.py` 4종을 돌린다(`test-backoffice-bridge-integration.py`는 Docker를 쓴다) |
| 공통 | [agent-harness.yml](../../.github/workflows/agent-harness.yml) | Agent Harness | 모든 PR과 main push(경로 필터 없음). 에이전트 설정·게이트 자체 검사, 하네스 문서의 링크·경로·워크플로 언급, 이 지도에 활성 워크플로가 모두 있는지, 스킬 머리말, 루트 `CLAUDE.md` 12KB 상한, 용어집 금지어, `.claude/skills/*/scripts`의 `test_*.py` |
| 공통 | [claude-review.yml](../../.github/workflows/claude-review.yml) | Claude PR Review | PR 댓글의 `@claude`. Claude PR 리뷰. 리뷰 줄 댓글 트리거는 잡 조건 때문에 늘 건너뛴다 |
| 공통 | [smoke-check.yml](../../.github/workflows/smoke-check.yml) | Smoke Checks | `smoke/server/**` 변경 PR(main·release). 스모크 케이스 오프라인 검사 |
| 공통 | [api-dog-generate.yml](../../.github/workflows/api-dog-generate.yml) | Generate OpenAPI Docs | Data·Business Java·`build.gradle` 변경 PR, main·release·`bfeat/`·`bfix/`·`brefactor/` push, 수동. OpenAPI 생성. push에서만 gh-pages 게시·Apidog 반영·Slack 알림 |
| 공통 | [api-docs-cleanup.yml](../../.github/workflows/api-docs-cleanup.yml) | Cleanup Feature Docs | 브랜치 삭제. 지운 `bfeat/`·`bfix/`·`brefactor/`·`feat/` 브랜치의 OpenAPI 문서를 gh-pages에서 지운다 |
| 공통 | [be-gradle.yml](../../.github/workflows/be-gradle.yml) | Backend Gradle | 재사용 전용. 서비스별 Gradle 검사(기본 `build`)와 같은 실행 안의 JAR 전달 |
| 공통 | [satellite-check.yml](../../.github/workflows/satellite-check.yml) | Satellite Checks | 재사용 전용. Business API·Notification 계약·통합 검사 |
| dev V2 서버 | [data-api-ci.dev-v2.yml](../../.github/workflows/data-api-ci.dev-v2.yml) | Data API CI (dev)-v2 | Data·Realtime·공용 빌드 입력 PR과 main push, 수동. Data·Realtime Gradle. main에서 GAR amd64 이미지 발행 |
| dev V2 서버 | [realtime-ci.dev-v2.yml](../../.github/workflows/realtime-ci.dev-v2.yml) | Realtime CI (dev)-v2 | `server/realtime/**` PR, `data-api-ci.dev-v2`가 호출. Realtime Gradle. 수동 실행 트리거는 없다 |
| dev V2 서버 | [satellite-ci.dev-v2.yml](../../.github/workflows/satellite-ci.dev-v2.yml) | Satellite CI (dev)-v2 | Business·Notification·Data·`server/scripts/**`·`.github/scripts/**` PR과 main push, 수동. 계약 검사·Gradle. main에서 GAR amd64 이미지 발행 |
| dev V2 런타임 | [kafka-ci.dev-v2.yml](../../.github/workflows/kafka-ci.dev-v2.yml) | Kafka CI (dev)-v2 | dev Kafka 런타임 파일 PR과 main push, 수동. 검사, main에서 GCS 산출물 발행 |
| dev V2 런타임 | [redis-ci.dev-v2.yml](../../.github/workflows/redis-ci.dev-v2.yml) | Redis CI (dev)-v2 | dev Redis 런타임 파일 PR과 main push, 수동. 검사, main에서 GCS 산출물 발행 |
| dev V2 런타임 | [postgres-ci.dev-v2.yml](../../.github/workflows/postgres-ci.dev-v2.yml) | PostgreSQL CI (dev)-v2 | dev PostgreSQL 런타임 파일 PR과 main push, 수동. 검사, main에서 GCS 산출물 발행 |
| dev V2 배포 | [cd-auto.dev-v2.yml](../../.github/workflows/cd-auto.dev-v2.yml) | Auto CD (dev)-v2 | 위 dev CI 5종의 main 완료, 수동. dev V2 VM 3대에 런타임·서버 배포, 스모크 호출, 배지 게시 |
| dev V2 배포 | [app-cd.dev-v2.yml](../../.github/workflows/app-cd.dev-v2.yml) | App CD (dev)-v2 | 수동(Infra manifest URI). 서버 4종 수동 배포. `force_redeploy`로 시크릿을 다시 반영한다 |
| dev V2 배포 | [kafka-cd.dev-v2.yml](../../.github/workflows/kafka-cd.dev-v2.yml) | Kafka CD (dev)-v2 | 수동(manifest URI). dev Kafka 런타임 적용 |
| dev V2 배포 | [redis-cd.dev-v2.yml](../../.github/workflows/redis-cd.dev-v2.yml) | Redis CD (dev)-v2 | 수동(manifest URI). dev Redis 런타임 적용 |
| dev V2 배포 | [postgres-cd.dev-v2.yml](../../.github/workflows/postgres-cd.dev-v2.yml) | Postgres CD (dev)-v2 | 수동(manifest URI). dev PostgreSQL 런타임 적용 |
| dev V2 배포 | [ops-smoke.dev-v2.yml](../../.github/workflows/ops-smoke.dev-v2.yml) | 서버 스모크 스냅샷 (dev)-v2 | 수동. `cd-auto.dev-v2`의 `record` 잡이 실행한다. `oneorthree-v2.dev.mooo.com` 스모크 |
| 운영 V2 | [prod-ci-V2.yml](../../.github/workflows/prod-ci-V2.yml) | Catus app CI V2 | main·release 대상 PR, release push, 수동. 운영 계획·Gradle. release push에서 arm64 ECR 이미지·S3 산출물·`catus-v*-V2` 태그 발행 |
| 운영 V2 | [prod-cd-V2.yml](../../.github/workflows/prod-cd-V2.yml) | Catus app CD V2 | 수동(release, `version`). `catus-production-V2` 승인 1회 → SSM으로 서버 4종을 운영 V2에 배포 |
| 운영 V2 | [kafka-ci.prod-V2.yml](../../.github/workflows/kafka-ci.prod-V2.yml) | Catus kafka CI V2 | `server/scripts/v2/prod/kafka*` PR(main·release), release push, 수동. 테스트, release push에서 설정 묶음·`kafka-v*-V2` 태그 발행 |
| 운영 V2 | [kafka-cd.prod-V2.yml](../../.github/workflows/kafka-cd.prod-V2.yml) | Catus kafka CD V2 | 수동(release, `version`). `catus-production-V2` 승인 1회 → SSM으로 운영 Kafka 배포 |
| 운영 V2 | [redis-ci.prod-V2.yml](../../.github/workflows/redis-ci.prod-V2.yml) | Catus redis CI V2 | `server/scripts/v2/prod/redis*` PR(main·release), release push, 수동. 테스트, release push에서 설정 묶음·`redis-v*-V2` 태그 발행 |
| 운영 V2 | [redis-cd.prod-V2.yml](../../.github/workflows/redis-cd.prod-V2.yml) | Catus redis CD V2 | 수동(release, `version`). `catus-production-V2` 승인 1회 → SSM으로 운영 Redis 배포 |
| 운영 V2 | [satellite-ci.prod.yml](../../.github/workflows/satellite-ci.prod.yml) | Satellite CI (prod) | release 대상 PR. Business API·Notification 경계 계약 검사. 승격 PR은 기능 테스트를 건너뛴다 |
| 백오피스 | [backoffice-ci.yml](../../.github/workflows/backoffice-ci.yml) | Backoffice CI | `backoffice/**` PR(main·release)과 main push, 수동. npm test·build와 관련 Python 테스트 |
| 백오피스 | [backoffice-cd.prod-V2.yml](../../.github/workflows/backoffice-cd.prod-V2.yml) | Catus backoffice CD V2 | `backoffice/**`(`.md` 제외) main push, 수동. 테스트·`backoffice-v*-V2` 발행 → `backoffice-production` 승인 1회 → SSM 운영 배포 |
| 모바일 앱 | [app-lint.yml](../../.github/workflows/app-lint.yml) | Lint | `app/app-dev/**` PR과 main push, 다른 워크플로가 호출. ESLint·Prettier·tsc·jest |
| 모바일 앱 | [app-android-build.yml](../../.github/workflows/app-android-build.yml) | Android Checks | Android 네이티브 입력 PR과 main push, 호출. Android 네이티브 컴파일·XML 검사 |
| 모바일 앱 | [app-android-ci.yml](../../.github/workflows/app-android-ci.yml) | Android CI | `app/app-dev/**`(iOS 폴더 제외) PR과 main push, 수동. PR은 계약 테스트만. main은 서버 선행 게이트 뒤 운영 V2 서버용 AAB |
| 모바일 앱 | [app-android-cd.yml](../../.github/workflows/app-android-cd.yml) | Android CD | Android CI 완료, 수동. 서명 뒤 Play internal 게시. 10-30 꺼졌다가 2026-11-02 18:08 KST 다시 켜짐 |
| 모바일 앱 | [app-ios-testflight-dev.yml](../../.github/workflows/app-ios-testflight-dev.yml) | iOS TestFlight (dev) | `app/app-dev/**`(Android·문서 제외) main push, 수동. 머지한 사람의 맥에서 dev TestFlight 업로드. 2026-11-02 현재 레포 변수 `IOS_DEV_RUNNERS`가 없어 main push 실행은 건너뛴다 |
| 모바일 앱 | [image-cache-swift.yml](../../.github/workflows/image-cache-swift.yml) | 이미지 캐시 Swift 검사 | `modules/catus-asset-cache/**` PR과 main push. Swift 검사 |
| 모바일 앱 | [ai-focus-integration.yml](../../.github/workflows/ai-focus-integration.yml) | AI Focus Integration Checks | AI 집중 측정 피처 브랜치(`afeat/GROMO-25*` 8개) 대상 PR. `app-lint`·`app-android-build`를 부른다 |
| 모바일 앱 | [image-assets.yml](../../.github/workflows/image-assets.yml) | 이미지 CDN | `assets-cdn/**` 등 PR과 main push는 검사. main 수동 실행은 CDN 발행·롤백(환경 `image-assets-<environment>`) |
| 기타 | [loadtest.yml](../../.github/workflows/loadtest.yml) | Loadtest | 수동. GCP의 k6 부하 시험 실행기. 2026-11-02 현재 `loadtest` 라벨 러너가 없다. 실행 조건은 [loadtest/README.md](../../loadtest/README.md) |

### 2-2 V1 워크플로와 V2 대응

2026-11-02 구 서버와 러너 종료 후 아래 V1 파일 14개를 제거했다. GitHub 등록은 모두 비활성화했다. V2와 공용 검사는 유지한다. `catus-plan.py`의 운영 지문 입력도 `prod-ci-V2.yml`로 갱신했으므로 다음 release에서 서버 4종의 지문이 바뀔 수 있다.

| V1 파일 | 상태(2026-11-02) | 하던 일 | V2 대응 |
| --- | --- | --- | --- |
| `prod-ci.yml` | 제거됨 | 운영 V1 발행 | [prod-ci-V2.yml](../../.github/workflows/prod-ci-V2.yml). 운영 지문 입력도 V2 CI로 전환했다 |
| `prod-cd.yml` | 제거됨 | 운영 V1 배포(환경 `catus-production`) | [prod-cd-V2.yml](../../.github/workflows/prod-cd-V2.yml) |
| `data-api-ci.dev.yml` | 제거됨 | 옛 dev VM Data·Realtime CI | [data-api-ci.dev-v2.yml](../../.github/workflows/data-api-ci.dev-v2.yml) |
| `realtime-ci.dev.yml` | 제거됨 | 옛 dev VM Realtime CI | [realtime-ci.dev-v2.yml](../../.github/workflows/realtime-ci.dev-v2.yml) |
| `data-api-cd.dev.yml` | 제거됨 | 옛 dev VM Data·Realtime 배포 | [cd-auto.dev-v2.yml](../../.github/workflows/cd-auto.dev-v2.yml) |
| `satellite-ci.dev.yml` | 제거됨 | 옛 dev VM Business·Notification CI | [satellite-ci.dev-v2.yml](../../.github/workflows/satellite-ci.dev-v2.yml) |
| `satellite-cd.dev.yml` | 제거됨 | 옛 dev VM Business·Notification 배포 | [cd-auto.dev-v2.yml](../../.github/workflows/cd-auto.dev-v2.yml) |
| `ops-smoke.dev.yml` | 제거됨 | `oneorthree.dev.mooo.com` 스모크 | [ops-smoke.dev-v2.yml](../../.github/workflows/ops-smoke.dev-v2.yml) |
| `ops-datadog.dev.yml` | 제거됨 | 옛 dev VM Datadog 켜기·끄기 | 없음. dev V2는 Datadog에 연결되지 않았다 |
| `ops-kafka.dev.yml` | 제거됨 | 옛 dev VM Kafka up·prepare·status·down | [kafka-cd.dev-v2.yml](../../.github/workflows/kafka-cd.dev-v2.yml)(적용만, status·down 없음) |
| `ops-monitor.dev.yml` | 제거됨 | 옛 dev VM Prometheus·Grafana·Loki | 없음 |
| `ops-redeploy.dev.yml` | 제거됨 | 꺼진 V1 배포 잡 재실행 | [app-cd.dev-v2.yml](../../.github/workflows/app-cd.dev-v2.yml)의 `force_redeploy`(서버 4종 함께) |
| `ops-stack.dev.yml` | 제거됨 | V1 워크플로 이름으로 배포 흐름 요약, 옛 dev VM 런타임 상태 | 없음 |
| `ops-deployment-badges.yml` | 제거됨 | V1 워크플로 6개 완료 때 배포 배지 게시 | 없음. V2 배지는 `cd-auto.dev-v2`와 운영 V2 CD의 `record` 잡이 직접 게시한다 |

### 2-3 GitHub에 등록됐지만 파일이 없는 워크플로

2026-11-02 GitHub 워크플로 목록 조회 기준이다. main에는 세 파일이 없다.

- `codex-review.yml`: PR #80(07-01, 머지 안 됨)에서 등록됐다. Codex 리뷰는 지금 `chatgpt-codex-connector` 앱이 붙인다.
- `generate-api-docs.yml`: 05-16~05-26 `feat/mvp-core` 브랜치에서 돌았다. 표시 이름이 `api-dog-generate.yml`과 같다.
- `link-handoff-ci.yml`: PR #736(09-11, 머지 안 됨)에서 등록됐다. `link/` 폴더는 없다.

## 3. 환경

| 항목 | dev V2 | 운영 V2 | 옛 것 |
| --- | --- | --- | --- |
| 호스트 | GCP 프로젝트 `oneorthree2`(asia-northeast3-a)의 VM `catus-dev-v2-app`·`catus-dev-v2-data`·`catus-dev-v2-redis` | AWS ap-northeast-2의 EC2 `catus-prod-V2`(서버 4종·nginx), `catus-kafka-prod-V2`, `catus-redis-prod-V2`, `catus-backoffice-prod-V2` | 삭제됨: 옛 dev VM `gromo-dev-app`·디스크·러너, 운영 V1 `catus-prod`·구 백오피스, Gromo 1.x 운영 서버 |
| DB | data VM의 PostgreSQL 컨테이너 | RDS `catus-prod-db`(운영 V1 서버 종료 후에도 보존). `catus-prod-db-v2`는 있지만 쓰지 않는다 | |
| 공개 주소 | `oneorthree-v2.dev.mooo.com` | `catus-api-v2.oneorthree.world`, `backoffice-v2.oneorthree.world` | `oneorthree.dev.mooo.com`(삭제한 옛 dev VM 주소. 앱 dev 빌드는 dev V2 주소로 전환함) |
| 시크릿 | `catus/dev/env-v2`, `catus/dev/cicd-v2` | `catus/prod/cicd-V2`, `catus/prod/env`(V2에서 계속 사용), `catus/prod/database-V2`. 전체 표는 Infra `prod/catus-v2/README-V2.md` | `gromo/dev/env`(옛 dev VM), `catus/prod/cicd`·`catus/prod/database`(운영 V1) |
| 이미지 | GAR `asia-northeast3-docker.pkg.dev/oneorthree2/<서비스>/<서비스>:dev-v2-<sha>-<run_id>-<attempt>`. digest로 배포 | ECR `catus-prod/<서비스>-v2`(Infra `prod/catus-v2/storage-V2.tf` 기준). digest로 배포 | |
| 산출물 | `gs://catus-dev-v2-deploy-263851348176` | `s3://catus-prod-deploy-artifacts-808715036056-v2` | |
| 인증 | GCP WIF(레포 변수 `GCP_DEV_V2_WIF_PROVIDER`·`GCP_DEV_V2_DEPLOY_SA`), AWS OIDC(레포 변수 `AWS_DEV_V2_ROLE_ARN`) | AWS 역할 `catus-prod-publish-V2`(발행), `catus-prod-deploy-V2`(배포), `catus-backoffice-release-V2`(백오피스) | |
| Infra 고정 | 고정 없음. 최신 `infra/*/manifest.json` 또는 입력 `infra_manifest_uri` | 레포 변수 `CATUS_PROD_INFRA_REVISION_V2`(Infra 커밋 SHA) | 운영 V1 `CATUS_PROD_INFRA_REVISION` |
| 성공 기록 | 호스트 저널 `/opt/catus-dev-v2/app/deployment-journal.json`, GCS `deployments/<역할>/current.json`, `deployment-status` 브랜치 `state.json`·`dev.json` | S3 `deployments/<역할>/current-V2.json`, `deployment-status` 브랜치 `prod-V2/<역할>.json`과 서비스별 `prod-V2/<서비스>.json` | `deployment-status` 브랜치 `prod.json` |

dev V2 반영 확인: `cd-auto.dev-v2` 실행의 성공은 배포했다는 뜻이 아니다. `plan` 잡이 기다림이나 재실행으로 끝나면 `app` 잡은 돌지 않는다. 반영은 `app` 잡 결과, 호스트 저널의 `release_id`, 실행 중 컨테이너 이미지로 확인한다.

## 4. 버전 축

현재 값은 적지 않는다. 읽는 곳에서 확인한다.

| 축 | 읽는 곳 | 누가·언제 올리나 |
| --- | --- | --- |
| 앱 버전(iOS) | `app/app-dev/ios/Cattus.xcodeproj/project.pbxproj`의 `MARKETING_VERSION`, `ios/Cattus/Info.plist`, `iosStoreVersionConfig.js` | 사람이 PR로 |
| 앱 버전(Android) | `app/app-dev/android/app/build.gradle`의 `versionName`, `app.config.js`의 `version` | 사람이 PR로 |
| 빌드 번호(iOS) | TestFlight. pbxproj `CURRENT_PROJECT_VERSION`은 하한이다 | fastlane이 업로드 때 정한다. max(그 마케팅 버전의 TestFlight 최대, pbxproj 값) + 1이고 커밋하지 않는다(`ios/fastlane/Fastfile`) |
| 빌드 번호(Android `versionCode`) | Play 콘솔. `build.gradle` 값은 하한이다 | `app-android-ci`가 max(`ANDROID_VERSION_CODE_BASE`, `build.gradle`) + 실행 번호로 정한다(`.github/ci/android-artifact.py`). 로컬 업로드는 사람이 정한다 |
| runtimeVersion | `app/app-dev/app.config.js`(플랫폼별), `ios/Cattus/Supporting/Expo.plist`, `android/app/src/main/res/values/strings.xml` | 네이티브가 바뀔 때 사람이 |
| OTA 업데이트 id | 요청 헤더 `X-App-Update-Id`(`app/app-dev/src/services/api/client.ts`) | `app/app-dev/scripts/ota-update.sh`를 실행할 때마다 |
| 서버 태그 | git 태그 `catus-v*-V2`. 지금 운영 태그는 `deployment-status` 브랜치 `prod-V2/app.json` | `prod-ci-V2`의 release 발행마다 `-V2` 태그 중 최대의 patch + 1 |
| 서버 태그(V1) | git 태그 `catus-v*`(`-V2` 없음), `.github/scripts/catus-version.py` | 꺼짐 |
| Kafka·Redis·백오피스 태그 | git 태그 `kafka-v*-V2`·`redis-v*-V2`·`backoffice-v*-V2` | 각 CI의 발행마다 patch + 1. 백오피스는 main 머지마다 |
| Infra revision | 레포 변수 `CATUS_PROD_INFRA_REVISION_V2` | 사람이 |
| dev 이미지 태그 | GAR 태그 `dev-v2-<sha>-<run_id>-<attempt>` | dev CI 실행마다 |
| 앱 git 태그 | `app-1.0.0-*`, `app-1.1.0-*` | 1.x 레인만 붙였다. 2.x 앱 태그는 없다 |
| GitHub Releases | 없다(2026-11-02 조회) | |
| Jira fixVersion | Jira | 사람이. 2.0.0까지만 있다(2026-11-02 조회) |
| API 경로 | `app/app-dev/src/services/api/client.ts` | 버전을 붙이지 않는다. `/api/v1`은 1.x 표면이고 기기 푸시 토큰만 예외다 |
| Flyway | data-api `db/v0`(현행)·`db/migration`(동결), notification·realtime `db/migration` | 새 파일을 더한다. 적용된 파일은 고치지 않는다 |
| 강제 업데이트 최소 버전 | `GET /auth/sessions/app-requirements`, data-api `db/v0/V9__developer_notice_min_versions.sql`(개발자 공지의 최소 버전 열) | 백오피스의 개발자 공지로 |

숫자 크기로 최신을 판단하지 않는다. V1 태그 `catus-v2.1.0`~`catus-v3.0.0`은 V2 태그보다 숫자가 크지만 옛 것이다. data-api `db/v0`의 `V9`는 동결된 `db/migration`의 `V138`보다 새것이다.

## 5. 모니터링 이름

Datadog us5, 2026-11-02 최근 24시간 로그 기준이다.

| 가리키는 것 | Datadog service | host | env |
| --- | --- | --- | --- |
| 운영 V2 서버 4종 | `data-api`, `business-api`, `realtime`, `notification` | `catus-prod-V2` | `prod` |
| 운영 V2 nginx | `nginx` | `catus-prod-V2`, `catus-backoffice-prod-V2` | `prod` |
| 운영 V2 Kafka | `catus-kafka-prod-V2`(서비스 이름 = 호스트 이름) | `catus-kafka-prod-V2` | `prod` |
| 운영 V2 백오피스 | `catus-backoffice-prod-v2`(소문자 v) | `catus-backoffice-prod-V2` | `prod` |
| Datadog Agent | `agent` | 운영 V2 호스트 4대 | `prod` |
| 옛 dev VM | `data-api`, `business-api`, `realtime`, `gromo-kafka-dev`, `gromo-db-dev`, `gromo-redis-dev` | `gromo-dev` | `dev` |
| Gromo 1.x 운영 | `gromo-back-prod`, `gromo-nginx-prod` | `gromo-prod` | `prod` |
| 모바일 앱 RUM | `cattus-app` | | `prod`·`dev` |

- dev V2는 Datadog에 보고하지 않는다. `env:dev`로 보면 옛 dev VM이다.
- 대시보드 `z2h-qq5-8vk`(CATUS · PROD 통합 관측)는 V1 서비스 이름을 써서 V2 일부를 못 본다(2026-11-02 조회).
- 링크 목록의 정본은 [backoffice/src/monitoringLinkList.ts](../../backoffice/src/monitoringLinkList.ts)다. Datadog 대시보드·모니터, PostHog, 옛 dev Grafana 터널, 상태 주소, 클라우드 콘솔이 있다. 모바일 앱 오류는 PostHog 대시보드 `2234116`과 Sentry로 본다.
