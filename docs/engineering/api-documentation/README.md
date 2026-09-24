# API 문서 — 서비스별 OpenAPI · Apidog 분리

GROMO-2069. 두 백엔드 서비스의 OpenAPI 스펙을 각각 생성하고, Apidog 에는 네임스페이스가
갈린 **병합 스펙 하나를 한 번** import 한다.

## §1 서비스와 소유권

| 서비스 | Gradle | 게시 스펙 | 역할 |
| --- | --- | --- | --- |
| `server/business-api` | `business-api.openapi.json` | `public` 그룹 | 앱 공개 계약 (BFF) |
| `server/data-api` | `data-api.openapi.json` | `internal` 그룹 | 서버 간 계약 (`/internal/**`) |

- business-api 의 `public` 그룹은 `OpenApiConfig.PUBLIC_PATH_PATTERNS` 허용 목록에
  있는 접두사만 담는다. `/internal/**`·`/actuator/**`·`/error`·`/health`(비즈니스
  헬스체크는 문서 대상 아님)는 절대 들어가지 않는다. 호환용 `/api/v1/**` 라우트는
  같은 스펙에 담기지만 Apidog 폴더는 `business-api/legacy` 로 격리된다.
- data-api 의 `internal` 그룹은 `/internal/**` 만 담는다. `/api/v1/**` 는 `legacy`
  그룹(`/v0/api-docs/legacy`)으로 따로 생성되지만 **게시하지 않는다** — 잔존 계약의
  정본은 `legacy-v1-manifest.md` 이다. 삭제 계획 자체는
  `../legacy-v1-retirement/README.md` 참조.
- 생성은 실제 Spring Boot 기동(`generateOpenApiDocs` 플러그인)이라 조건부 빈·
  Jackson 이름·advice 응답 스키마가 실서버와 동일하게 반영된다.
- 경계 위반은 두 겹으로 막는다 — 단위 테스트(`OpenApiAllowlistDriftTest`,
  `OpenApiGroupBoundaryTest`)가 컨트롤러 애노테이션을 스캔해 새 라우트의 누락·
  경계 위반을 잡고, 병합 스크립트가 생성된 스펙의 서비스 경계를 다시 검사한다.

## §2 생성 엔드포인트

| 서비스 | 엔드포인트 | 접근 |
| --- | --- | --- |
| business-api | `/v0/api-docs/public` | `AccessTokenFilter.PUBLIC_PATHS` 에 정확히 이 경로만 허용. prod 는 `springdoc.api-docs.enabled: false` 라 매핑 자체가 없어 404 — 인증 우회 아님 |
| data-api | `/v0/api-docs/internal` | 기존과 동일(필터가 `/api/*` 만 검사) |
| data-api | `/v0/api-docs/legacy` | 격리·수동 조회용. 게시 파이프라인에 안 탄다 |

## §3 Apidog 동기화

- 폴더는 operation 의 `x-apidog-folder` 가 정한다 — tags 보다 우선하고 `/` 로 계층을
  나눈다(공식 문서: https://docs.apidog.com/x-apidog-folder-1981658m0).
  - `business-api` — 공개 경로
  - `business-api/legacy` — 호환 `/api/v1/**`
  - `data-api` — `/internal/**`
- 병합(`.github/scripts/apidog-merge.py`)은 컴포넌트 이름과 모든 `$ref`·
  discriminator 매핑·securityScheme 이름에 `business-api.`/`data-api.` 접두어를
  붙여 충돌을 없앤다. 경로 소유권 충돌·중복 operationId·dangling `$ref`·빈 스펙은
  병합 단계에서 실패한다.
- **primary 프로젝트(기본 `1283919`, `vars.APIDOG_PROJECT_ID_PRIMARY` 로 재지정
  가능)에는 병합 스펙을 정확히 한 번 import 한다.** `deleteUnmatchedResources: true`
  라 두 스펙의 순차 import 는 뒤 서비스가 앞 서비스 문서를 지운다 — 절대 금지.
  이 옵션이 Apidog 쪽 stale 문서 삭제도 겸한다.
- Soobin(`1305019`)·KTH(`1328838`) 개인 프로젝트는 기존 비파괴 정책을 유지한다 —
  같은 병합 스펙을 넣되 `deleteUnmatchedResources` 없이,
  `updateFolderOfChangedEndpoint: false` 로 기존 엔드포인트는 제자리에 둔다.
  새 엔드포인트만 `x-apidog-folder` 폴더로 들어간다. 프로젝트 ID 는 재용도하지
  않는다 — 덮어쓸 때는 `vars.APIDOG_PROJECT_ID_SOOBIN` / `_KTH` 만 쓴다.
- 응답 판정·카운터 검증은 기존 `.github/scripts/apidog-import.sh` 가 그대로 한다.

## §4 워크플로

`.github/workflows/api-dog-generate.yml`:

- **PR**: 두 스펙 생성 + 병합 검증까지만. gh-pages 게시·Apidog import·Slack 은
  `github.event_name == 'push'` 게이트로 차단된다 — PR 에서 외부에 쓰지 않는다.
- **push**(main/release/bfeat|bfix|brefactor): 스펙 생성 → 병합·검증 → gh-pages
  게시 → Apidog 3곳 동기화.
- gh-pages 경로는 `branches/<safe-ref>/<service>/` 한 규칙이다(`/`→`-` 치환).
  release 는 루트, main 은 `staging/` 아래 `business-api/`·`data-api/`.
- `.github/workflows/api-docs-cleanup.yml` 은 브랜치 삭제 시
  `branches/<safe-ref>` 와 구 레이아웃 `<ref>/` 잔재를 같은 멱등 루프로 지운다.

## §5 알려진 한계 · 연기된 일

- business-api 의 `PUBLIC_PATH_PATTERNS` 는 전수 조사로 만든 허용 목록이다 — 새
  공개 라우트는 목록에 없으면 문서에서 빠진다. `OpenApiAllowlistDriftTest` 가
  컨트롤러 스캔과 목록을 대조해 누락을 빨간 테스트로 만든다.
- 스펙 간 **브레이킹 체인지 diff**(이전 버전 대비)는 아직 없다 — 병합 검증이 구조적
  충돌만 본다. 필요해지면 별도 티켓.
- data-api `legacy` 그룹은 매번 생성되지만 게시되지 않는다. 매니페스트와의 drift 는
  `legacy-v1-manifest.md` §3 절차로 수동 확인한다.
